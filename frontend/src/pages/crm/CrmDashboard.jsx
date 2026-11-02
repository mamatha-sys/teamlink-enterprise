// CRM > DASHBOARD (2026-11-02): the sales picture at a glance and today's work - follow-ups due today and late (tick them
// done here), deals by stage, closing soon, lead sources, lost reasons, the latest calls / meetings. A BDE sees their own;
// the BDE TL / Admin / Manager see everybody's, or "Only mine".
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useCrm, errOf, money, moneyShort, dateOf, dateTimeOf, TaskList, recordLink, ACT_ICON, RecordPanel, useOpenParam, download, istToday } from './crmShared.jsx';
import { TeamTargets, ForecastFunnel, CrmSettings } from './CrmReports.jsx';

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

export default function CrmDashboard() {
  const { me } = useCrm();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useOpenParam(sp, setSp);
  const [mine, setMine] = useState(!me.seesAll);
  const { reloadMe, toast } = useCrm();
  const [tab, setTab] = useState(sp.get('tab') || 'overview'); // overview | team | forecast
  const [settings, setSettings] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get('/crm/dashboard', { params: mine ? { mine: 1 } : {} }).then((r) => { setD(r.data); setErr(''); }).catch((e) => setErr(errOf(e, 'The dashboard could not be read.')));
  useEffect(() => { load(); }, [mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const stat = (n, l, to) => (
    <div className={`stat-cell${to ? ' crm-stat-click' : ''}`} onClick={to ? () => navigate(to) : undefined} role={to ? 'link' : undefined} tabIndex={to ? 0 : undefined} onKeyDown={to ? (e) => { if (e.key === 'Enter') navigate(to); } : undefined}>
      <div className="v">{n}</div><div className="l">{l}</div>
    </div>
  );
  const due = d ? d.followUps.overdue.length + d.followUps.today.length : 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>CRM Dashboard</h1>
          <div className="page-sub">{d ? `${d.scope === 'all' ? 'Whole sales team' : 'My'} sales · ${dateOf(d.today)}` : 'Sales'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {me.seesAll && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, fontWeight: 500 }}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 'auto' }} /> Only mine
            </label>
          )}
          {me.canAssign && <button type="button" className="btn" onClick={() => setSettings(true)} title="Sources, lost reasons, stage probabilities">⚙ Settings</button>}
          <select className="btn" defaultValue="" onChange={(e) => { const k = e.target.value; e.target.value = ''; if (k) download(`/crm/export/${k}`, `crm-${k}-${istToday()}.csv`).catch(() => toast('The download did not work.')); }} aria-label="Download" style={{ width: 'auto' }}>
            <option value="">Download…</option><option value="leads">Leads</option><option value="deals">Deals</option><option value="accounts">Accounts</option><option value="contacts">Contacts</option><option value="activities">Calls, meetings, notes</option><option value="tasks">Follow-ups</option>
          </select>
          {me.canEdit && <Link className="btn" to="/crm/leads?add=1">+ Lead</Link>}
          {me.canEdit && <Link className="btn btn-primary" to="/crm/deals?add=1">+ Deal</Link>}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[['overview', 'Overview'], ['team', me.seesAll ? 'Team & targets' : 'My month & target'], ['forecast', 'Forecast & funnel']].map(([k, l]) => (
          <div key={k} role="tab" tabIndex={0} aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)} onKeyDown={(e) => { if (e.key === 'Enter') setTab(k); }}>{l}</div>
        ))}
      </div>
      {tab === 'team' && <TeamTargets />}
      {tab === 'forecast' && <ForecastFunnel />}
      {tab === 'overview' && err && <div className="notice" role="alert">{err}</div>}
      {tab === 'overview' && !d && !err && <div className="small-muted">Loading…</div>}
      {tab === 'overview' && d && (
        <>
          <div className="stat-row" style={{ marginBottom: 16 }}>
            {stat(moneyShort(d.pipeline.value), `Open pipeline · ${d.pipeline.open} deal${d.pipeline.open === 1 ? '' : 's'} (likely ${moneyShort(d.pipeline.weighted)})`, '/crm/deals')}
            {stat(`${d.month.won} · ${moneyShort(d.month.wonValue)}`, `Won this month${d.month.winRate != null ? ` · win rate ${d.month.winRate}%` : ''}`, '/crm/deals')}
            {stat(d.month.lost, 'Lost this month', '/crm/deals')}
            {stat(d.leads.open, `Open leads · ${d.leads.newThisMonth} new this month`, '/crm/leads')}
          </div>
          <div className="crm-dash">
            <div className="card">
              <div className="section-label" style={{ marginTop: 0 }}>Follow-ups to do {due ? `(${due})` : ''}</div>
              {d.followUps.overdue.length > 0 && <div className="small-muted" style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 2 }}>Late</div>}
              {d.followUps.overdue.length > 0 && <TaskList tasks={d.followUps.overdue} showRecord onChanged={load} canEdit={me.canEdit} />}
              <div className="small-muted" style={{ fontWeight: 600, margin: '8px 0 2px' }}>Today</div>
              <TaskList tasks={d.followUps.today} showRecord onChanged={load} canEdit={me.canEdit} />
              {d.followUps.upcoming.length > 0 && (
                <>
                  <div className="small-muted" style={{ fontWeight: 600, margin: '10px 0 2px' }}>Next 7 days</div>
                  <TaskList tasks={d.followUps.upcoming} showRecord onChanged={load} canEdit={me.canEdit} />
                </>
              )}
            </div>
            <div className="card">
              <div className="section-label" style={{ marginTop: 0 }}>Pipeline by stage</div>
              <Bars rows={d.byStage} label={(r) => r.stage} value={(r) => r.value || 0} right={(r) => `${r.count} · ${moneyShort(r.value)}`} />
              <div className="small-muted" style={{ marginTop: 6, fontSize: 11.5 }}>Won and Lost: this month.</div>
            </div>
            <div className="card">
              <div className="section-label" style={{ marginTop: 0 }}>Closing in the next 30 days</div>
              {!d.closingSoon.length && <div className="small-muted">No open deal has an expected close date in the next 30 days.</div>}
              {d.closingSoon.map((x) => (
                <div key={x.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={recordLink('deal', x.id)}>{x.title}</Link>
                    <div className="small-muted" style={{ fontSize: 11.5 }}>{x.accountName || ''} · {x.stage}{d.scope === 'all' && x.ownerName ? ` · ${x.ownerName}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{money(x.value)}</div>
                    <div className="small-muted" style={{ fontSize: 11.5, color: x.late ? 'var(--red)' : undefined }}>{x.late ? 'late · ' : ''}{dateOf(x.expectedClose)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="section-label" style={{ marginTop: 0 }}>Where leads come from</div>
              <Bars rows={d.leads.bySource} value={(r) => r.count} />
              <div className="section-label">Leads by status</div>
              <Bars rows={d.leads.byStatus} value={(r) => r.count} />
              {d.lostReasons.length > 0 && (
                <>
                  <div className="section-label">Why deals were lost (90 days)</div>
                  <Bars rows={d.lostReasons} value={(r) => r.count} />
                </>
              )}
            </div>
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="section-label" style={{ marginTop: 0 }}>Latest calls, meetings and notes</div>
              {!d.recent.length && <div className="small-muted">Nothing logged yet. Open a lead or a deal and log a call.</div>}
              {d.recent.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                  <span aria-hidden="true">{ACT_ICON[a.kind] || '•'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {a.subject || a.kind} {a.recordName && <>· <Link to={recordLink(a.recordKind, a.recordId)}>{a.recordName}</Link></>}
                    {a.note && <div className="small-muted" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.note}</div>}
                  </div>
                  <div className="small-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{dateTimeOf(a.at)}{a.byName ? ` · ${a.byName}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {open && <RecordPanel kind={open.kind} id={open.id} onClose={() => setOpen(null)} onChanged={load} />}
      {settings && <CrmSettings onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reloadMe(); }} />}
    </div>
  );
}
