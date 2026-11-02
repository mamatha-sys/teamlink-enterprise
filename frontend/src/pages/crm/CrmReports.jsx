// CRM > DASHBOARD - the report tabs and the settings (2026-11-02, the full CRM):
//   TeamTargets     every BDE this month: leads added, converted, calls, meetings, won (count, ₹), open pipeline, target and
//                   how much of it is done; the BDE TL / Admin set each target right in the table. A BDE sees their own row.
//   ForecastFunnel  open deals by the month they should close (late / this month / next two / later / no date), the funnel of
//                   this month's leads, and the deals going cold (nothing logged for N days)
//   CrmSettings     lead sources, lost reasons, the probability of each stage, the "going cold" days, proposal validity
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import Modal from '../../components/Modal.jsx';
import { useCrm, errOf, money, moneyShort, dateOf, recordLink, istToday } from './crmShared.jsx';

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

export function useReports(month) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get('/crm/reports', { params: { month } }).then((r) => { setD(r.data); setErr(''); }).catch((e) => setErr(errOf(e, 'The report could not be read.')));
  useEffect(() => { setD(null); load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, err, load };
}

export function MonthPicker({ month, setMonth }) {
  const now = istToday().slice(0, 7);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <button type="button" className="btn btn-sm" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">‹</button>
      <b style={{ minWidth: 130, textAlign: 'center', fontSize: 13 }}>{monthLabel(month)}</b>
      <button type="button" className="btn btn-sm" disabled={month >= now} onClick={() => setMonth(shift(month, 1))} aria-label="Next month">›</button>
    </span>
  );
}

function TargetCell({ row, month, onSaved }) {
  const { me, toast } = useCrm();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  if (!me.canAssign || row.former) return <span>{row.target ? moneyShort(row.target) : '—'}</span>;
  async function save() {
    try { await api.put('/crm/targets', { month, ownerId: row.ownerId, amount: v || 0 }); toast(`Target saved for ${row.ownerName}.`); setEdit(false); onSaved(); } catch (e) { toast(errOf(e, 'The target could not be saved.')); }
  }
  if (!edit) return <button type="button" className="btn btn-sm" onClick={() => { setV(row.target || ''); setEdit(true); }} title="Set the target (won value this month)">{row.target ? moneyShort(row.target) : 'Set'}</button>;
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} style={{ width: 110 }} aria-label={`Target for ${row.ownerName} in ₹`} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(false); }} />
      <button type="button" className="btn btn-sm btn-primary" onClick={save}>Save</button>
    </span>
  );
}

const Bar = ({ pct }) => (
  <div className="crm-bars" style={{ minWidth: 70 }}><div className="bar"><span style={{ width: `${Math.min(100, pct || 0)}%`, background: pct >= 100 ? 'var(--teal)' : undefined }} /></div></div>
);

export function TeamTargets() {
  const { me } = useCrm();
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const { d, err, load } = useReports(month);
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="section-label" style={{ margin: 0 }}>{me.seesAll ? 'Sales team: performance and targets' : 'My month and my target'}</div>
        <span style={{ marginLeft: 'auto' }}><MonthPicker month={month} setMonth={setMonth} /></span>
      </div>
      {err && <div className="notice" role="alert">{err}</div>}
      {!d && !err && <div className="small-muted">Loading…</div>}
      {d && (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Salesperson</th><th style={{ textAlign: 'right' }}>Leads added</th><th style={{ textAlign: 'right' }}>Converted</th><th style={{ textAlign: 'right' }}>Calls</th><th style={{ textAlign: 'right' }}>Meetings</th>
                <th style={{ textAlign: 'right' }}>Won</th><th style={{ textAlign: 'right' }}>Lost</th><th style={{ textAlign: 'right' }}>Open pipeline</th><th>Target</th><th>Done</th>
              </tr>
            </thead>
            <tbody>
              {!d.performance.length && <tr><td colSpan={10} className="small-muted">No one on the sales team yet.</td></tr>}
              {d.performance.map((r) => (
                <tr key={r.ownerId}>
                  <td><b>{r.ownerName}</b>{r.former ? <span className="small-muted"> (not on the sales team now)</span> : null}</td>
                  <td style={{ textAlign: 'right' }}>{r.leads}</td>
                  <td style={{ textAlign: 'right' }}>{r.converted}</td>
                  <td style={{ textAlign: 'right' }}>{r.calls}</td>
                  <td style={{ textAlign: 'right' }}>{r.meetings}</td>
                  <td style={{ textAlign: 'right' }}>{r.won ? <><b>{moneyShort(r.wonValue)}</b> <span className="small-muted">({r.won})</span></> : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.lost || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.openDeals ? <>{moneyShort(r.openValue)} <span className="small-muted">({r.openDeals})</span></> : '—'}</td>
                  <td><TargetCell row={r} month={month} onSaved={load} /></td>
                  <td>{r.achievement != null ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Bar pct={r.achievement} /><span style={{ fontSize: 12, fontWeight: 600 }}>{r.achievement}%</span></div> : <span className="small-muted">—</span>}</td>
                </tr>
              ))}
              {d.performance.length > 1 && (
                <tr style={{ background: 'var(--line-soft)' }}>
                  <td><b>Team</b></td>
                  <td style={{ textAlign: 'right' }}>{d.totals.leads}</td><td style={{ textAlign: 'right' }}>{d.totals.converted}</td><td style={{ textAlign: 'right' }}>{d.totals.calls}</td><td style={{ textAlign: 'right' }}>{d.totals.meetings}</td>
                  <td style={{ textAlign: 'right' }}><b>{moneyShort(d.totals.wonValue)}</b> <span className="small-muted">({d.totals.won})</span></td>
                  <td style={{ textAlign: 'right' }}>{d.totals.lost}</td>
                  <td style={{ textAlign: 'right' }}>{moneyShort(d.totals.openValue)}</td>
                  <td>{d.totals.target ? moneyShort(d.totals.target) : '—'}</td>
                  <td>{d.totals.achievement != null ? `${d.totals.achievement}%` : '—'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="small-muted" style={{ marginTop: 8, fontSize: 11.5 }}>Target = the value of deals won in the month. {me.canAssign ? 'Click "Set" to give a salesperson their target.' : 'Your sales manager sets the targets.'}</div>
    </div>
  );
}

export function ForecastFunnel() {
  const { me } = useCrm();
  const month = istToday().slice(0, 7);
  const { d, err } = useReports(month);
  if (err) return <div className="notice" role="alert">{err}</div>;
  if (!d) return <div className="small-muted">Loading…</div>;
  const maxF = Math.max(1, ...d.forecast.map((f) => f.value));
  const top = Math.max(1, d.funnel[0].count);
  return (
    <div className="crm-dash">
      <div className="card">
        <div className="section-label" style={{ marginTop: 0 }}>Forecast: open deals by expected close</div>
        <div className="crm-bars">
          {d.forecast.map((f) => (
            <div className="row" key={f.key}>
              <div style={{ color: f.key === 'late' && f.count ? 'var(--red)' : undefined }}>{f.label}</div>
              <div className="bar"><span style={{ width: `${(f.value / maxF) * 100}%`, background: f.key === 'late' ? 'var(--red)' : undefined }} /></div>
              <div className="n">{f.count ? moneyShort(f.value) : '—'}</div>
            </div>
          ))}
        </div>
        <div className="small-muted" style={{ marginTop: 8, fontSize: 11.5 }}>
          Likely (value × probability): this month {moneyShort((d.forecast.find((f) => f.key === month) || {}).weighted)}, next month {moneyShort((d.forecast[2] || {}).weighted)}.
          {d.forecast[0].count ? ' Late deals: update their close date or close them.' : ''}
        </div>
      </div>
      <div className="card">
        <div className="section-label" style={{ marginTop: 0 }}>Lead funnel: leads added this month</div>
        <div className="crm-bars">
          {d.funnel.map((f, i) => (
            <div className="row" key={f.step}>
              <div>{f.step}</div>
              <div className="bar"><span style={{ width: `${(f.count / top) * 100}%` }} /></div>
              <div className="n">{f.count}{i > 0 && d.funnel[0].count ? ` · ${Math.round((f.count / d.funnel[0].count) * 100)}%` : ''}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="section-label" style={{ marginTop: 0 }}>Going cold: open deals with nothing logged for {d.staleDays}+ days</div>
        {!d.stale.length && <div className="small-muted">None. Every open deal had a call, meeting or note in the last {d.staleDays} days.</div>}
        {d.stale.map((x) => (
          <div key={x.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={recordLink('deal', x.id)}>{x.title}</Link>
              <div className="small-muted" style={{ fontSize: 11.5 }}>{[x.accountName, x.stage, me.seesAll ? x.ownerName : null].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>{money(x.value)}</div>
              <div className="small-muted" style={{ fontSize: 11.5, color: 'var(--red)' }}>{x.days} days quiet{x.lastActivityAt ? ` · last ${dateOf(x.lastActivityAt)}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CrmSettings({ onClose, onSaved }) {
  const { me, toast } = useCrm();
  const L = me.lists;
  const [f, setF] = useState({ sources: L.sources.join('\n'), lostReasons: L.lostReasons.join('\n'), stageProbability: { ...L.stageProbability }, staleDays: L.staleDays, proposalValidityDays: L.proposalValidityDays, salesTeam: (me.salesTeam || []).map((m) => ({ ...m })) });
  // the people picker for the sales team
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api.get('/crm/people', { params: { q } }).then((r) => setFound(r.data.people)).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  const addMember = (p) => { setF((x) => (x.salesTeam.some((m) => m.userId === p.id) ? x : { ...x, salesTeam: [...x.salesTeam, { userId: p.id, name: p.name, role: 'rep' }] })); setQ(''); setFound([]); };
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.put('/crm/settings', { ...f, sources: f.sources.split('\n'), lostReasons: f.lostReasons.split('\n') });
      toast('CRM settings saved.'); onSaved();
    } catch (e) { toast(errOf(e, 'The settings could not be saved.')); } finally { setBusy(false); }
  }
  return (
    <Modal title="CRM settings" size="wide" onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="section-label" style={{ marginTop: 0 }}>Sales team</div>
      <p className="small-muted" style={{ marginTop: 0 }}>Who uses the CRM. A <b>Salesperson</b> sees and works their own leads and deals; a <b>Sales manager</b> sees the whole team, gives leads to people, sets targets and these settings. The BDEs and BDE team leads are on the team already; add anybody else here.</p>
      {f.salesTeam.map((m, i) => (
        <div key={m.userId} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ flex: 1, fontSize: 13 }}><b>{m.name || m.userId}</b></span>
          <select value={m.role} onChange={(e) => setF((x) => ({ ...x, salesTeam: x.salesTeam.map((y, j) => (j === i ? { ...y, role: e.target.value } : y)) }))} style={{ width: 170 }} aria-label={`Role of ${m.name}`}>
            <option value="rep">Salesperson</option><option value="manager">Sales manager</option>
          </select>
          <button type="button" className="btn btn-sm" onClick={() => setF((x) => ({ ...x, salesTeam: x.salesTeam.filter((_, j) => j !== i) }))} aria-label={`Remove ${m.name}`}>Remove</button>
        </div>
      ))}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input type="text" placeholder="Add a person: type a name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add a person to the sales team" />
        {found.length > 0 && (
          <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, padding: 4, maxHeight: 220, overflow: 'auto' }}>
            {found.map((p) => (
              <button key={p.id} type="button" className="btn btn-sm" style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', marginBottom: 2 }} onClick={() => addMember(p)}>
                {p.name} <span className="small-muted">{p.email}{p.role ? ` · ${p.role}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid-2">
        <div className="field"><label>Lead sources (one per line)</label><textarea rows={8} value={f.sources} onChange={(e) => setF({ ...f, sources: e.target.value })} /></div>
        <div className="field"><label>Reasons a deal is lost (one per line)</label><textarea rows={8} value={f.lostReasons} onChange={(e) => setF({ ...f, lostReasons: e.target.value })} /></div>
      </div>
      <div className="section-label">Probability of each stage (%)</div>
      <div className="grid-3">
        {L.stages.filter((s) => s !== 'Won' && s !== 'Lost').map((s) => (
          <div className="field" key={s}><label>{s}</label><input type="number" min={0} max={100} value={f.stageProbability[s]} onChange={(e) => setF({ ...f, stageProbability: { ...f.stageProbability, [s]: e.target.value } })} /></div>
        ))}
      </div>
      <div className="grid-2">
        <div className="field"><label>A deal is "going cold" after this many days with nothing logged</label><input type="number" min={1} max={365} value={f.staleDays} onChange={(e) => setF({ ...f, staleDays: e.target.value })} /></div>
        <div className="field"><label>A proposal is valid for (days)</label><input type="number" min={1} max={365} value={f.proposalValidityDays} onChange={(e) => setF({ ...f, proposalValidityDays: e.target.value })} /></div>
      </div>
      <div className="small-muted">"Other" is always kept in both lists. The stages themselves stay as they are, so the board and the reports keep working. A new probability applies the next time a deal moves.</div>
    </Modal>
  );
}
