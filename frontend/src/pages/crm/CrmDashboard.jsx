// CRM > DASHBOARD (2026-11-02; redesigned after the founder's reference picture, a Zoho-style sales dashboard):
//   Overview      five cards (leads, customers, revenue won, sales target, follow-ups due) with the change against the period
//                 before; the sales funnel with the conversion rate and 6 months of won value; activities today; recent
//                 deals; follow-ups to do; the lead-to-customer flow; closing soon; where leads come from; lost reasons
//   Activities    every call, meeting, email, WhatsApp and note in one list (filters by type, date, salesperson, text)
//   Team & targets / Forecast & funnel   (CrmReports.jsx)
// A salesperson sees their own; a sales manager / Admin / Manager see the whole team, or "Only mine". Period: this month,
// last month, this quarter, this year.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useCrm, errOf, money, moneyShort, dateOf, dateTimeOf, TaskList, recordLink, ACT_ICON, RecordPanel, useOpenParam, download, istToday } from './crmShared.jsx';
import { TeamTargets, ForecastFunnel, CrmSettings } from './CrmReports.jsx';

// small line icons for the cards and lists (currentColor)
const I = {
  users: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 9v-1a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8" />,
  hand: <path d="M2 11l4-4 4 2 3-3 4 1 5 5-4 4-3-1-3 3-4-1zM9 9l4 4M12 16l-2-2" />,
  rupee: <path d="M6 3h12M6 8h12M14 21L6 13h3a5 5 0 0 0 0-10" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  check: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 3v3h6V3M8 13l3 3 5-6" /></>,
};
const Icon = ({ name, size = 26 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[name]}</svg>;
const KIND_COLOR = { call: 'var(--crm-green)', meeting: 'var(--crm-blue)', email: 'var(--crm-violet)', whatsapp: 'var(--crm-teal)', note: 'var(--crm-orange)', task: 'var(--crm-orange)' };
const STAGE_TONE = { Won: 'joined', Lost: 'rejected', Negotiation: 'interview', 'Proposal sent': 'offer' };

function Delta({ v }) {
  if (v == null) return <span className="crm-delta">new</span>;
  return <span className={`crm-delta${v < 0 ? ' down' : ''}`}>{v >= 0 ? '↑' : '↓'} {Math.abs(v)}%</span>;
}

function Kpi({ icon, color, label, value, children, to }) {
  const navigate = useNavigate();
  return (
    <div className="crm-kpi" role={to ? 'link' : undefined} tabIndex={to ? 0 : undefined} onClick={to ? () => navigate(to) : undefined} onKeyDown={to ? (e) => { if (e.key === 'Enter') navigate(to); } : undefined}>
      <div className="ic" style={{ background: color }}><Icon name={icon} /></div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="l">{label}</div>
        <div className="v">{value}</div>
        {children}
      </div>
    </div>
  );
}

function Bars({ rows, value, label = (r) => r.name, right }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.length) return <div className="small-muted">Nothing yet.</div>;
  return (
    <div className="crm-bars">
      {rows.map((r) => (
        <div className="row" key={label(r)}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(r)}</div>
          <div className="bar"><span style={{ width: `${(value(r) / max) * 100}%` }} /></div>
          <div className="n">{right ? right(r) : value(r)}</div>
        </div>
      ))}
    </div>
  );
}

const Head = ({ title, to, onClick, link = 'View all' }) => (
  <div className="crm-card-head">
    <h3>{title}</h3>
    {to && <Link to={to}>{link} →</Link>}
    {onClick && <button type="button" className="crm-linkbtn" onClick={onClick}>{link} →</button>}
  </div>
);

const FUNNEL_COLORS = ['var(--crm-blue)', 'var(--crm-green)', 'var(--crm-orange)', 'var(--crm-violet)', 'var(--crm-navy)'];

function Overview({ mine, period, onTab }) {
  const { me } = useCrm();
  const [o, setO] = useState(null);
  const [d, setD] = useState(null);
  const [sup, setSup] = useState(null);
  const [err, setErr] = useState('');
  const load = () => {
    const params = mine ? { mine: 1 } : {};
    api.get('/crm/tickets', { params: { status: 'open' } }).then((r) => setSup(r.data.stats)).catch(() => setSup(null));
    api.get('/crm/overview', { params: { ...params, period } }).then((r) => { setO(r.data); setErr(''); }).catch((e) => setErr(errOf(e, 'The dashboard could not be read.')));
    api.get('/crm/dashboard', { params }).then((r) => setD(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [mine, period]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="notice" role="alert">{err}</div>;
  if (!o) return <div className="small-muted">Loading…</div>;
  const c = o.cards;
  const maxTrend = Math.max(1, ...o.trend.map((t) => t.value));
  const top = Math.max(1, o.funnel[0].count);
  return (
    <>
      <div className="crm-kpis">
        <Kpi icon="users" color="var(--crm-blue)" label="Total leads" value={c.leads.value.toLocaleString('en-IN')} to="/crm/leads"><Delta v={c.leads.delta} /> <span className="crm-sub">{c.leads.open} open</span></Kpi>
        <Kpi icon="hand" color="var(--crm-green)" label="Total customers" value={c.customers.value.toLocaleString('en-IN')} to="/crm/accounts"><span className="crm-sub">+{c.customers.newInPeriod} won {o.periodLabel.toLowerCase()}</span></Kpi>
        <Kpi icon="rupee" color="var(--crm-violet)" label="Revenue (won)" value={moneyShort(c.revenue.value)} to="/crm/deals"><Delta v={c.revenue.delta} /> <span className="crm-sub">{c.revenue.deals} deal{c.revenue.deals === 1 ? '' : 's'}</span></Kpi>
        <Kpi icon="target" color="var(--crm-orange)" label="Sales target" value={c.target.value ? moneyShort(c.target.value) : 'Not set'} to="/crm/dashboard?tab=team">
          {c.target.value ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div className="crm-progress"><span style={{ width: `${Math.min(100, c.target.pct || 0)}%` }} /></div>
              <b style={{ fontSize: 12.5 }}>{c.target.pct}%</b>
            </div>
          ) : <span className="crm-sub">{me.canAssign ? 'Set it in Team & targets' : 'Your sales manager sets it'}</span>}
        </Kpi>
        <Kpi icon="check" color="var(--crm-teal)" label="Follow-ups due" value={c.followUps.today + c.followUps.late} to="/crm/dashboard?tab=overview">
          {c.followUps.late ? <span className="crm-delta down">{c.followUps.late} late</span> : <span className="crm-sub">all on time</span>}
        </Kpi>
      </div>

      <div className="crm-grid3">
        <div className="crm-card">
          <Head title="Sales pipeline" to="/crm/deals" link="View deals" />
          <div className="crm-funnel-wrap">
            <div className="crm-funnel">
              {o.funnel.map((f, i) => (
                <div key={f.step} className="crm-funnel-step" style={{ background: FUNNEL_COLORS[i], width: `${100 - i * 11}%`, opacity: f.count || i === 0 ? 1 : 0.55 }} title={`${f.step}: ${f.count}`}>
                  <span>{f.step}</span><b>{f.count.toLocaleString('en-IN')}</b>
                </div>
              ))}
            </div>
            <div className="crm-funnel-side">
              <div className="small-muted">Conversion rate</div>
              <div className="crm-big">{o.conversion != null ? `${o.conversion}%` : '—'}</div>
              <div className="small-muted" style={{ fontSize: 11 }}>leads added {o.periodLabel.toLowerCase()} that are won</div>
              <div className="crm-trend" title="Won value, last 6 months">
                {o.trend.map((t) => <span key={t.month} style={{ height: `${Math.max(4, (t.value / maxTrend) * 100)}%` }} title={`${t.month}: ${money(t.value)} (${t.won})`} />)}
              </div>
              <div className="small-muted" style={{ fontSize: 10.5 }}>won value, 6 months</div>
            </div>
          </div>
          <div className="small-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Open pipeline {moneyShort(c.pipeline.value)} in {c.pipeline.open} deal{c.pipeline.open === 1 ? '' : 's'} · likely {moneyShort(c.pipeline.weighted)}</div>
        </div>

        <div className="crm-card">
          <Head title="Activities today" onClick={() => onTab('activities')} />
          {!o.todayList.length && <div className="small-muted">Nothing logged or due today yet.</div>}
          {o.todayList.slice(0, 7).map((x) => (
            <div key={`${x.type}${x.id}`} className="crm-today">
              <span className="dot" style={{ color: KIND_COLOR[x.kind] || 'var(--ink-soft)' }} aria-hidden="true">{x.kind === 'task' ? (x.done ? '☑' : '🔔') : ACT_ICON[x.kind]}</span>
              <span className="t">{x.time || '—'}</span>
              <span className="s">
                <span style={{ textDecoration: x.type === 'task' && x.done ? 'line-through' : undefined }}>{x.title}</span>
                {x.recordName && <Link to={recordLink(x.recordKind, x.recordId)}> · {x.recordName}</Link>}
              </span>
            </div>
          ))}
        </div>

        <div className="crm-card">
          <Head title="Recent deals" to="/crm/deals" />
          {!o.recentDeals.length && <div className="small-muted">No deals yet. Convert a lead or add a deal.</div>}
          {o.recentDeals.map((x) => (
            <Link key={x.id} to={recordLink('deal', x.id)} className="crm-deal-row">
              <span className="b" aria-hidden="true">🏢</span>
              <span className="n">{x.accountName || x.title}<small>{x.accountName ? x.title : ''}</small></span>
              <span className="v">{money(x.value)}</span>
              <span className={`status ${STAGE_TONE[x.stage] || 'review'}`}>{x.stage}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="crm-grid2">
        <div className="crm-card">
          <Head title={`Follow-ups to do${d ? ` (${d.followUps.overdue.length + d.followUps.today.length})` : ''}`} />
          {!d && <div className="small-muted">Loading…</div>}
          {d && (
            <>
              {d.followUps.overdue.length > 0 && <div className="small-muted" style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 2 }}>Late</div>}
              {d.followUps.overdue.length > 0 && <TaskList tasks={d.followUps.overdue} showRecord onChanged={load} canEdit={me.canEdit} />}
              <div className="small-muted" style={{ fontWeight: 600, margin: '8px 0 2px' }}>Today</div>
              <TaskList tasks={d.followUps.today} showRecord onChanged={load} canEdit={me.canEdit} />
              {d.followUps.upcoming.length > 0 && (<><div className="small-muted" style={{ fontWeight: 600, margin: '10px 0 2px' }}>Next 7 days</div><TaskList tasks={d.followUps.upcoming} showRecord onChanged={load} canEdit={me.canEdit} /></>)}
            </>
          )}
        </div>
        <div className="crm-card">
          <Head title="CRM business flow" />
          <div className="small-muted" style={{ marginTop: -6, marginBottom: 10, fontSize: 12 }}>Lead to loyal customer</div>
          <div className="crm-flow">
            {o.flow.map((f, i) => (
              <div key={f.key} className="crm-flow-step-wrap">
                <Link to={f.to} className="crm-flow-step" style={{ '--tone': FUNNEL_COLORS[i] }}>
                  <span className="c">{f.count.toLocaleString('en-IN')}</span>
                  <b>{f.label}</b>
                  <small>{f.sub}</small>
                </Link>
                {i < o.flow.length - 1 && <span className="arrow" aria-hidden="true">→</span>}
              </div>
            ))}
          </div>
          {sup && (
            <Link to="/crm/accounts?tab=tickets" className="crm-support-line">
              <span aria-hidden="true">🎧</span> <b>Customer support</b>
              <span>{sup.open} open</span>
              <span style={{ color: sup.late ? 'var(--red)' : undefined }}>{sup.late} reply late</span>
              <span>{sup.resolved30} resolved (30 days)</span>
              <span style={{ marginLeft: 'auto', color: 'var(--crm-blue)', fontWeight: 600 }}>Tickets →</span>
            </Link>
          )}
          {d && d.closingSoon.length > 0 && (
            <>
              <div className="section-label">Closing in the next 30 days</div>
              {d.closingSoon.slice(0, 5).map((x) => (
                <div key={x.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><Link to={recordLink('deal', x.id)}>{x.title}</Link><div className="small-muted" style={{ fontSize: 11.5 }}>{x.accountName || ''} · {x.stage}</div></div>
                  <div style={{ textAlign: 'right' }}><b>{moneyShort(x.value)}</b><div className="small-muted" style={{ fontSize: 11.5, color: x.late ? 'var(--red)' : undefined }}>{x.late ? 'late · ' : ''}{dateOf(x.expectedClose)}</div></div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {d && (
        <div className="crm-grid2">
          <div className="crm-card">
            <Head title="Where leads come from" to="/crm/leads" link="Leads" />
            <Bars rows={d.leads.bySource} value={(r) => r.count} />
          </div>
          <div className="crm-card">
            <Head title="Pipeline by stage" to="/crm/deals" link="Board" />
            <Bars rows={d.byStage} label={(r) => r.stage} value={(r) => r.value || 0} right={(r) => `${r.count} · ${moneyShort(r.value)}`} />
            {d.lostReasons.length > 0 && (<><div className="section-label">Why deals were lost (90 days)</div><Bars rows={d.lostReasons} value={(r) => r.count} /></>)}
          </div>
        </div>
      )}
    </>
  );
}

function Activities({ mine }) {
  const { me, toast } = useCrm();
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/crm/activities', { params: { kind: kind || undefined, from: from || undefined, to: to || undefined, owner: (mine ? me.userId : owner) || undefined, q: q || undefined } })
        .then((r) => setD(r.data)).catch((e) => toast(errOf(e, 'The activities could not be read.')));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [kind, from, to, owner, q, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const KINDS = [['', 'All'], ...Object.entries(me.lists.activityKinds)];
  return (
    <div className="crm-card">
      <div className="filter-row">
        {KINDS.map(([k, l]) => (
          <button key={k || 'all'} type="button" className={`btn btn-sm${kind === k ? ' btn-primary' : ''}`} onClick={() => setKind(k)}>
            {k ? `${ACT_ICON[k]} ` : ''}{l}{d && k && d.byKind[k] ? ` · ${d.byKind[k]}` : ''}
          </button>
        ))}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 150 }} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 150 }} />
        {me.seesAll && !mine && <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Salesperson"><option value="">Everyone</option>{me.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <input type="text" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} aria-label="Search activities" />
        <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => download('/crm/export/activities', `crm-activities-${istToday()}.csv`).catch(() => toast('The download did not work.'))}>Download</button>
      </div>
      {!d && <div className="small-muted">Loading…</div>}
      {d && !d.rows.length && <div className="empty"><h3>Nothing here</h3>Calls, meetings, emails, WhatsApp messages and notes logged on leads, deals and accounts show up here.</div>}
      {d && d.rows.map((a) => (
        <div key={a.id} className="crm-act-row">
          <span className="ic" style={{ background: KIND_COLOR[a.kind] }} aria-hidden="true">{ACT_ICON[a.kind]}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5 }}><b>{a.subject || me.lists.activityKinds[a.kind]}</b>{a.recordName && <> · <Link to={recordLink(a.recordKind, a.recordId)}>{a.recordName}</Link></>}</div>
            {a.note && <div className="small-muted" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{a.note}</div>}
          </div>
          <div className="small-muted" style={{ fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap' }}>{dateTimeOf(a.at)}<br />{a.byName || ''}</div>
        </div>
      ))}
    </div>
  );
}

export default function CrmDashboard() {
  const { me, reloadMe, toast } = useCrm();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useOpenParam(sp, setSp);
  const [mine, setMine] = useState(!me.seesAll);
  const [period, setPeriod] = useState('month');
  const [tab, setTab] = useState(sp.get('tab') || 'overview'); // overview | activities | team | forecast
  const [settings, setSettings] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="page crm-page">
      <div className="page-head">
        <div>
          <h1>Sales Dashboard</h1>
          <div className="page-sub">Welcome back, {String(me.name || '').split(' ')[0] || 'there'} · {mine ? 'my sales' : 'whole sales team'} · {dateOf(istToday())}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {me.seesAll && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, fontWeight: 500 }}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 'auto' }} /> Only mine
            </label>
          )}
          {tab === 'overview' && (
            <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" style={{ width: 'auto' }}>
              <option value="month">This month</option><option value="last_month">Last month</option><option value="quarter">This quarter</option><option value="year">This year</option>
            </select>
          )}
          {me.canAssign && <button type="button" className="btn" onClick={() => setSettings(true)} title="Sales team, sources, lost reasons, stage probabilities">⚙ Settings</button>}
          <select defaultValue="" onChange={(e) => { const k = e.target.value; e.target.value = ''; if (k) download(`/crm/export/${k}`, `crm-${k}-${istToday()}.csv`).catch(() => toast('The download did not work.')); }} aria-label="Download" style={{ width: 'auto' }}>
            <option value="">Download…</option><option value="leads">Leads</option><option value="deals">Deals</option><option value="accounts">Accounts</option><option value="contacts">Contacts</option><option value="activities">Calls, meetings, notes</option><option value="tasks">Follow-ups</option>
          </select>
          {me.canEdit && <Link className="btn" to="/crm/leads?add=1">+ Lead</Link>}
          {me.canEdit && <Link className="btn btn-primary" to="/crm/deals?add=1">+ Deal</Link>}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[['overview', 'Overview'], ['activities', 'Activities'], ['team', me.seesAll ? 'Team & targets' : 'My month & target'], ['forecast', 'Forecast & funnel']].map(([k, l]) => (
          <div key={k} role="tab" tabIndex={0} aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)} onKeyDown={(e) => { if (e.key === 'Enter') setTab(k); }}>{l}</div>
        ))}
      </div>
      {tab === 'overview' && <Overview key={refresh} mine={mine} period={period} onTab={setTab} />}
      {tab === 'activities' && <Activities mine={mine} />}
      {tab === 'team' && <TeamTargets />}
      {tab === 'forecast' && <ForecastFunnel />}
      {open && <RecordPanel kind={open.kind} id={open.id} onClose={() => setOpen(null)} onChanged={() => setRefresh((n) => n + 1)} />}
      {settings && <CrmSettings onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reloadMe(); }} />}
    </div>
  );
}

