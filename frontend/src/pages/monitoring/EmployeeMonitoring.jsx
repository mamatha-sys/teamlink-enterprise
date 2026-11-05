import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import ListPageHeader from '../../components/ui/ListPageHeader.jsx';
import ExportMenu from '../../components/ExportMenu.jsx';
import Combo from '../../components/Combo.jsx';
import {
  KpiRow, KpiTile, Panel, BarList, Pill,
} from '../../components/atskit/AtsKit.jsx';
import './monitoring.css';

// ---------------------------------------------------------------------------
// HRMS -> EMPLOYEE MONITORING (2026-11-04). How office PCs are used in work hours, from the TeamLink desktop agent the
// employee installs and agrees to (backend: routes/monitoring.js, utils/monitoring.js; the agent: backend/agent/TeamLinkMonitor.ps1).
//   HR / Admin  Live Dashboard · Reports · App usage · Productivity rules · Devices · Audit log · Settings · My activity
//   TL / STL / Manager  Live Dashboard · Reports · App usage (their own team) · My activity
//   everyone    My activity: their own day, their PCs and the notice they accepted
// Only the app name, window title and active / idle time are recorded - never keystrokes, passwords, the clipboard,
// screenshots or chat content - and only after the employee accepts the notice.
// ---------------------------------------------------------------------------
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const errOf = (e, d) => (e && e.response && e.response.data && e.response.data.error) || d;
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const dt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
// under an hour reads in minutes: "0.0 h" said nothing about 2 minutes of work
const h = (v) => { if (v == null) return '—'; const n = Number(v); if (!n) return '0 h'; return n < 1 ? `${Math.max(1, Math.round(n * 60))} min` : `${n.toFixed(1)} h`; };
const dur = (sec) => (sec < 60 ? `${sec} sec` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);
const pct = (v) => (v == null ? '—' : `${v}%`);
const CAT_TONE = { productive: 'green', neutral: 'slate', unproductive: 'red' };
const CAT_WORD = { productive: 'Productive', neutral: 'Neutral', unproductive: 'Unproductive' };
const STATUS_TONE = { Online: 'green', Idle: 'amber', 'On break': 'teal', 'Clocked out': 'slate', 'On leave': 'violet', Offline: 'slate' };

function useGet(url, params, deps = []) {
  const [st, setSt] = useState({ data: null, error: '', loading: true });
  const load = useCallback(() => {
    if (!url) return;
    setSt((s) => ({ ...s, loading: true, error: '' }));
    api.get(url, params ? { params } : undefined)
      .then((r) => setSt({ data: r.data, error: '', loading: false }))
      .catch((e) => setSt({ data: null, error: errOf(e, 'Could not load this.'), loading: false }));
  }, [url, JSON.stringify(params || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, reload: load };
}

export default function EmployeeMonitoring() {
  const [params, setParams] = useSearchParams();
  const me = useGet('/monitoring/me');
  const admin = !!(me.data && me.data.isAdmin);
  const lead = !!(me.data && me.data.isLead);
  const tabs = admin
    ? [['overview', 'Live Dashboard'], ['reports', 'Reports'], ['usage', 'App usage'], ['categories', 'Productivity rules'], ['devices', 'Devices'], ['audit', 'Audit log'], ['settings', 'Settings'], ['mine', 'My activity']]
    : lead ? [['overview', 'Live Dashboard'], ['reports', 'Reports'], ['usage', 'App usage'], ['mine', 'My activity']] : [['mine', 'My activity']];
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0][0];
  const employee = params.get('employee');
  const go = (t, extra = {}) => setParams({ tab: t, ...extra });

  if (me.loading && !me.data) return <div className="small-muted">Loading…</div>;
  if (me.error) return <div className="notice red">{me.error}</div>;
  return (
    <div className="mon">
      <ListPageHeader
        title="Employee Monitoring"
        question={admin || lead
          ? 'How office PCs are used in work hours: active time, idle time and the apps used. Only what employees agreed to is recorded.'
          : 'What TeamLink records on your office PC in work hours, and the notice you accepted.'}
      />
      {tabs.length > 1 && (
        <div className="tabs" style={{ marginBottom: 14 }}>
          {tabs.map(([k, label]) => <div key={k} className={`tab${tab === k && !employee ? ' active' : ''}`} onClick={() => go(k)}>{label}</div>)}
        </div>
      )}
      {employee && (admin || lead)
        ? <EmployeeDetail id={employee} onBack={() => go(tab)} />
        : (
          <>
            {tab === 'overview' && <Overview onOpen={(id) => go('overview', { employee: id })} />}
            {tab === 'categories' && <Categories />}
            {tab === 'reports' && <Reports onOpen={(id) => go('reports', { employee: id })} />}
            {tab === 'usage' && <Usage />}
            {tab === 'audit' && <Audit />}
            {tab === 'devices' && <Devices manage />}
            {tab === 'settings' && <Settings />}
            {tab === 'mine' && <Mine me={me} />}
          </>
        )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Overview
function Overview({ onOpen }) {
  const [date, setDate] = useState(todayIst());
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useGet('/monitoring/overview', { date });
  const live = date === todayIst();
  // live: refreshes by itself every 30 seconds
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => { if (!document.hidden) reload(); }, 30000);
    return () => clearInterval(t);
  }, [live, reload]);
  const rows = useMemo(() => ((data && data.rows) || []).filter((r) => (!dept || r.department === dept) && (!team || r.team === team)
    && (!status || r.status === status)
    && (!q.trim() || `${r.name} ${r.code || ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, dept, team, status, q]);
  const c = data && data.cards;
  const card = (s) => ({ active: status === s, onClick: live ? () => setStatus(status === s ? '' : s) : undefined });
  return (
    <>
      <div className="mon-bar">
        <label>Day <input type="date" value={date} max={todayIst()} onChange={(e) => { setDate(e.target.value || todayIst()); setStatus(''); }} /></label>
        <input type="search" placeholder="Search a name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        <Combo value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {((data && data.departments) || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Combo>
        <Combo value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {((data && data.teams) || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Combo>
        {live && <span className="small-muted" style={{ marginLeft: 'auto' }}>Live: refreshes every 30 seconds</span>}
      </div>
      {error && <div className="notice red">{error}</div>}
      <KpiRow>
        <KpiTile icon="users" tone="blue" label="Tracked" value={c ? c.tracked : null} loading={loading && !c} sub="With a registered PC" />
        <KpiTile icon="check" tone="green" label="Online" value={live && c ? c.online : (live ? null : '—')} loading={loading && !c} sub="Using the PC now" {...card('Online')} />
        <KpiTile icon="pause" tone="amber" label="Idle" value={live && c ? c.idle : (live ? null : '—')} loading={loading && !c} sub="PC on, not in use" {...card('Idle')} />
        <KpiTile icon="x" tone="slate" label="Offline" value={live && c ? c.offline : (live ? null : '—')} loading={loading && !c} sub="No signal for 3 minutes" {...card('Offline')} />
        <KpiTile icon="leave" tone="violet" label="On leave" value={c ? c.onLeave : null} loading={loading && !c} sub="Approved leave today" {...card('On leave')} />
        <KpiTile icon="clock" tone="teal" label="Avg active" value={c ? `${c.avgActiveHours} h` : null} loading={loading && !c} sub={`Avg idle ${c ? c.avgIdleHours : 0} h`} />
      </KpiRow>
      <div className="tbl-wrap">
        <table className="mon-table">
          <thead><tr><th>Employee</th><th>Department</th>{live && <th>Status</th>}{live && <th>Using now</th>}<th>First seen</th><th>Last seen</th><th className="num">Active</th><th className="num">Idle</th><th className="num">Break</th><th className="num" title="Time in apps marked Productive, out of the active time">Productivity</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="row-link" onClick={() => onOpen(r.employeeId)}>
                <td><b>{r.name}</b>{r.code && <div className="small-muted">{r.code}</div>}</td>
                <td>{r.department || '—'}{r.team && <div className="small-muted">{r.team}</div>}</td>
                {live && <td><Pill tone={STATUS_TONE[r.status] || 'slate'}>{r.status || '—'}</Pill></td>}
                {live && <td>{r.currentApp || <span className="small-muted">—</span>}</td>}
                <td>{tm(r.firstSeen)}</td>
                <td>{live && r.lastHeartbeat ? dt(r.lastHeartbeat) : tm(r.lastSeen)}</td>
                <td className="num">{h(r.activeHours)}</td>
                <td className="num">{h(r.idleHours)}</td>
                <td className="num">{h(r.breakHours)}</td>
                <td className="num">{pct(r.productivity)}</td>
              </tr>
            ))}
            {!rows.length && !loading && <tr><td colSpan={live ? 10 : 8} className="small-muted">{(data && data.rows && data.rows.length) ? 'Nobody matches these filters.' : 'No PC is registered yet. Settings has the steps to set one up.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Dates (Reports, App usage, Audit log)
function RangeBar({ from, to, setFrom, setTo, children }) {
  const pick = (a, b) => { setFrom(a); setTo(b); };
  const t = todayIst();
  return (
    <div className="mon-bar">
      <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To <input type="date" value={to} min={from} max={t} onChange={(e) => setTo(e.target.value)} /></label>
      <button type="button" className="btn btn-sm" onClick={() => pick(t, t)}>Today</button>
      <button type="button" className="btn btn-sm" onClick={() => pick(addDays(t, -6), t)}>Week</button>
      <button type="button" className="btn btn-sm" onClick={() => pick(`${t.slice(0, 7)}-01`, t)}>This month</button>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ App & website usage
function Usage() {
  const [from, setFrom] = useState(addDays(todayIst(), -6));
  const [to, setTo] = useState(todayIst());
  const [department, setDepartment] = useState('');
  const { data, error } = useGet('/monitoring/usage', { from, to, department });
  const list = (rows, empty, noun) => (
    <table className="mon-table">
      <thead><tr><th>{noun}</th><th className="num">Time</th><th className="num">People</th><th>Category</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.key}><td><b>{a.name}</b></td><td className="num">{h(a.hours)}</td><td className="num">{a.people}</td><td>{a.category ? <Pill tone={CAT_TONE[a.category]}>{CAT_WORD[a.category]}</Pill> : <span className="small-muted">Not set</span>}</td></tr>
        ))}
        {!rows.length && <tr><td colSpan={4} className="small-muted">{empty}</td></tr>}
      </tbody>
    </table>
  );
  const s = data && data.split;
  return (
    <>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <Combo value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {((data && data.departments) || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Combo>
      </RangeBar>
      {error && <div className="notice red">{error}</div>}
      {s && (
        <KpiRow>
          <KpiTile icon="check" tone="green" label="Productive" value={h(s.productive)} sub="Active time" />
          <KpiTile icon="list" tone="slate" label="Neutral" value={h(s.neutral)} sub="Active time" />
          <KpiTile icon="alert" tone="red" label="Unproductive" value={h(s.unproductive)} sub="Active time" />
          <KpiTile icon="file" tone="amber" label="Not marked" value={h(s.unset)} sub="Mark them in Productivity rules" />
        </KpiRow>
      )}
      {data && (
        <div className="mon-two">
          <Panel title="Top apps" flush>{list(data.topApps, 'No app used in these days.', 'App')}</Panel>
          <Panel title="Top websites" sub="Sites with a rule, found in the browser's window title" flush>{list(data.topSites, 'No marked website used in these days.', 'Website')}</Panel>
        </div>
      )}
      {data && data.byDepartment.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Panel title="By department" flush>
            <table className="mon-table">
              <thead><tr><th>Department</th><th className="num">Productive</th><th className="num">Neutral</th><th className="num">Unproductive</th><th className="num">Not marked</th></tr></thead>
              <tbody>{data.byDepartment.map((t) => <tr key={t.name}><td><b>{t.name}</b></td><td className="num">{h(t.productive)}</td><td className="num">{h(t.neutral)}</td><td className="num">{h(t.unproductive)}</td><td className="num">{h(t.unset)}</td></tr>)}</tbody>
            </table>
          </Panel>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Audit log
function Audit() {
  const [from, setFrom] = useState(addDays(todayIst(), -29));
  const [to, setTo] = useState(todayIst());
  const { data, error } = useGet('/monitoring/audit', { from, to });
  const rows = (data && data.rows) || [];
  return (
    <>
      <div className="small-muted" style={{ marginBottom: 8 }}>Who looked at whose activity, what was exported, settings changes and PCs set up or switched off.</div>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {error && <div className="notice red">{error}</div>}
      <div className="tbl-wrap">
        <table className="mon-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(r.at)}</td><td><b>{r.who}</b></td><td>{r.action}</td><td className="small-muted mon-titles">{r.detail || '—'}</td></tr>)}
            {data && !rows.length && <tr><td colSpan={4} className="small-muted">Nothing in these days.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ One employee
function Timeline({ rows, workStart, workEnd, day }) {
  const a = new Date(`${day}T${workStart}:00+05:30`).getTime();
  const b = new Date(`${day}T${workEnd}:00+05:30`).getTime();
  const span = Math.max(1, b - a);
  const pos = (t) => Math.min(100, Math.max(0, ((new Date(t).getTime() - a) / span) * 100));
  const hours = [];
  for (let t = a; t <= b; t += 3600000) hours.push(t);
  return (
    <div className="mon-tl" aria-label="The day: active and idle">
      <div className="mon-tl-bar">
        {rows.map((r, i) => {
          const l = pos(r.start); const w = Math.max(0.2, pos(r.end) - l);
          return <span key={i} className={`mon-tl-seg ${r.break ? 'break' : r.idle ? 'idle' : 'active'}`} style={{ left: `${l}%`, width: `${w}%` }} title={`${tm(r.start)} – ${tm(r.end)} · ${r.break ? 'Break' : r.idle ? 'Idle' : r.app}`} />;
        })}
      </div>
      <div className="mon-tl-axis">
        {hours.map((t) => <span key={t} style={{ left: `${pos(t)}%` }}>{tm(t).replace(':00', '')}</span>)}
      </div>
      <div className="mon-tl-legend"><span><i className="active" /> Active</span><span><i className="idle" /> Idle</span><span><i className="break" /> Break</span><span><i /> No activity / PC off</span></div>
    </div>
  );
}

export function EmployeeDetail({ id, onBack, own = false }) {
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(todayIst());
  const { data, error, loading } = useGet(`/monitoring/employee/${id}`, { from, to });
  const t = data && data.totals;
  return (
    <>
      {onBack && <button type="button" className="btn btn-sm" onClick={onBack} style={{ marginBottom: 10 }}>← Back</button>}
      {data && !own && <h2 className="mon-h2">{data.employee.name}<span className="small-muted">{[data.employee.employeeCode, data.employee.department, data.employee.designation].filter(Boolean).join(' · ')}</span></h2>}
      <div className="mon-bar">
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || todayIst())} /></label>
        <label>To <input type="date" value={to} min={from} max={todayIst()} onChange={(e) => setTo(e.target.value || from)} /></label>
        <button type="button" className="btn btn-sm" onClick={() => { setFrom(todayIst()); setTo(todayIst()); }}>Today</button>
        <button type="button" className="btn btn-sm" onClick={() => { setFrom(addDays(todayIst(), -6)); setTo(todayIst()); }}>7 days</button>
      </div>
      {error && <div className="notice red">{error}</div>}
      {loading && !data && <div className="small-muted">Loading…</div>}
      {data && (
        <>
          <KpiRow>
            <KpiTile icon="clock" tone="green" label="Active" value={h(t.activeHours)} sub={`First ${tm(t.first)} · last ${tm(t.last)}`} />
            <KpiTile icon="pause" tone="amber" label="Idle" value={h(t.idleHours)} sub={`Break ${h(t.breakHours)}`} />
            <KpiTile icon="trend" tone="blue" label="Productivity" value={pct(t.productivity)} sub="Productive apps, of the active time" />
            <KpiTile icon="calendar" tone="violet" label="Days with activity" value={data.perDay.length} sub={`${data.from} to ${data.to}`} />
          </KpiRow>
          {data.timeline && (
            <Panel title="The day" sub={`Work hours ${data.workStart} – ${data.workEnd}`}>
              {data.timeline.length ? <Timeline rows={data.timeline} workStart={data.workStart} workEnd={data.workEnd} day={data.from} /> : <div className="ak-empty">No activity on this day.</div>}
            </Panel>
          )}
          {!data.timeline && data.perDay.length > 0 && (
            <Panel title="Day by day" flush>
              <table className="mon-table">
                <thead><tr><th>Day</th><th>First</th><th>Last</th><th className="num">Active</th><th className="num">Idle</th><th className="num">Productivity</th></tr></thead>
                <tbody>{data.perDay.map((d) => <tr key={d.day}><td>{d.day}</td><td>{tm(d.first)}</td><td>{tm(d.last)}</td><td className="num">{h(d.activeHours)}</td><td className="num">{h(d.idleHours)}</td><td className="num">{pct(d.productivity)}</td></tr>)}</tbody>
              </table>
            </Panel>
          )}
          <div className="mon-two">
            <Panel title="Top 10 apps and websites" sub="Active time">
              <BarList showShare rows={data.top10.map((a, i) => ({ key: a.key, label: a.name, value: a.seconds, tone: ['blue', 'violet', 'teal', 'amber', 'green', 'pink', 'slate', 'blue', 'violet', 'teal'][i] }))} format={dur} empty="No app used in this period." />
            </Panel>
            <Panel title="All apps and websites" flush>
              <div className="mon-scroll">
                <table className="mon-table">
                  <thead><tr><th>App / website</th><th className="num">Time</th><th>Category</th></tr></thead>
                  <tbody>
                    {data.apps.map((a) => (
                      <tr key={a.key}>
                        <td><b>{a.name}</b>{a.kind === 'site' && <span className="small-muted"> · website</span>}{a.topTitles.length > 0 && <div className="small-muted mon-titles">{a.topTitles.map((x) => `${x.title} (${x.minutes ? `${x.minutes} min` : 'under 1 min'})`).join(' · ')}</div>}</td>
                        <td className="num">{dur(a.seconds)}</td>
                        <td>{a.category ? <Pill tone={CAT_TONE[a.category]}>{CAT_WORD[a.category]}</Pill> : <span className="small-muted">Not set</span>}</td>
                      </tr>
                    ))}
                    {!data.apps.length && <tr><td colSpan={3} className="small-muted">No app used in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ App categories
function Categories() {
  const { data, error, reload } = useGet('/monitoring/app-categories');
  const [form, setForm] = useState({ appName: '', kind: 'app', category: 'productive', department: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function save(body) {
    setMsg(''); setErr('');
    try { await api.post('/monitoring/app-categories', body); setMsg(`Saved: ${body.appName} is ${CAT_WORD[body.category].toLowerCase()}.`); setForm({ appName: '', kind: 'app', category: 'productive', department: '' }); reload(); } catch (e) { setErr(errOf(e, 'Could not save.')); }
  }
  // every app in the "not marked" list at once
  async function markAll(category) {
    const list = (data && data.uncategorised) || [];
    if (!list.length || !window.confirm(`Mark all ${list.length} as ${CAT_WORD[category]}?`)) return;
    setMsg(''); setErr('');
    try {
      for (const u of list) await api.post('/monitoring/app-categories', { appName: u.appName, kind: 'app', category }); // eslint-disable-line no-await-in-loop
      setMsg(`${list.length} app${list.length === 1 ? '' : 's'} marked ${CAT_WORD[category].toLowerCase()}.`);
    } catch (e) { setErr(errOf(e, 'Could not save all of them.')); }
    reload();
  }
  async function change(row, category) {
    try { await api.put(`/monitoring/app-categories/${row.id}`, { category }); reload(); } catch (e) { setErr(errOf(e, 'Could not save.')); }
  }
  async function remove(row) {
    if (!window.confirm(`Remove the category of ${row.appName}?`)) return;
    try { await api.delete(`/monitoring/app-categories/${row.id}`); reload(); } catch (e) { setErr(errOf(e, 'Could not remove.')); }
  }
  const pick = (value, onChange, label) => (
    <Combo value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="productive">Productive</option><option value="neutral">Neutral</option><option value="unproductive">Unproductive</option>
    </Combo>
  );
  return (
    <>
      <div className="small-muted" style={{ marginBottom: 8 }}>An <b>app</b> is matched by its name (chrome, excel, winword). A <b>website</b> is a word in the browser&apos;s window title (youtube, naukri, linkedin). A department&apos;s own rule wins over the rule for every department (LinkedIn for Recruitment, Tally for Accounts). The score is the active time in productive apps and websites.</div>
      <div className="mon-bar">
        <input placeholder="App (excel) or website word (naukri)" value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} aria-label="App or website" />
        <Combo value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="App or website"><option value="app">App</option><option value="site">Website</option></Combo>
        {pick(form.category, (v) => setForm({ ...form, category: v }), 'Category')}
        <Combo value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} aria-label="For which department">
          <option value="">Every department</option>
          {((data && data.departments) || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Combo>
        <button type="button" className="btn btn-primary btn-sm" disabled={!form.appName.trim()} onClick={() => save(form)}>Add</button>
      </div>
      {msg && <div className="notice green">{msg}</div>}
      {(err || error) && <div className="notice red">{err || error}</div>}
      <div className="mon-rules">
        <Panel title="Marked apps and websites" sub={data ? `${data.rows.length} rules` : undefined} flush>
          <div className="mon-scroll">
          <table className="mon-table">
            <thead><tr><th>App / website</th><th>Department</th><th>Category</th><th>Set by</th><th /></tr></thead>
            <tbody>
              {((data && data.rows) || []).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.appName}</b><div className="small-muted">{r.kind === 'site' ? 'Website' : 'App'}</div></td>
                  <td>{r.department || 'Every department'}</td>
                  <td>{pick(r.category, (v) => change(r, v), `Category of ${r.appName}`)}</td>
                  <td className="small-muted">{r.setBy || '—'}</td>
                  <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(r)}>Remove</button></td>
                </tr>
              ))}
              {data && !data.rows.length && <tr><td colSpan={5} className="small-muted">Nothing marked yet.</td></tr>}
            </tbody>
          </table>
          </div>
        </Panel>
        <Panel title="Seen in the last 30 days, not marked" sub="An app not marked lowers the score: mark the ones used most" flush>
          {data && data.uncategorised.length > 1 && (
            <div className="mon-markall">
              <span className="small-muted">Mark all as:</span>
              {['productive', 'neutral', 'unproductive'].map((c) => <button key={c} type="button" className="btn btn-sm" onClick={() => markAll(c)}>{CAT_WORD[c]}</button>)}
            </div>
          )}
          <table className="mon-table">
            <thead><tr><th>App</th><th className="num">Active</th><th>Mark as</th></tr></thead>
            <tbody>
              {((data && data.uncategorised) || []).map((u) => (
                <tr key={u.appName}>
                  <td><b>{u.appName}</b></td>
                  <td className="num">{h(u.hours)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {['productive', 'neutral', 'unproductive'].map((c) => <button key={c} type="button" className="btn btn-sm" style={{ marginRight: 4 }} onClick={() => save({ appName: u.appName, kind: 'app', category: c })}>{CAT_WORD[c]}</button>)}
                  </td>
                </tr>
              ))}
              {data && !data.uncategorised.length && <tr><td colSpan={3} className="small-muted">Every app seen is marked.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Reports
function Reports({ onOpen }) {
  const [from, setFrom] = useState(addDays(todayIst(), -6));
  const [to, setTo] = useState(todayIst());
  const [department, setDepartment] = useState('');
  const [view, setView] = useState('employee');
  const { data, error, loading } = useGet('/monitoring/reports', { from, to, department, view });
  const rows = (data && data.rows) || [];
  const nums = (r) => (
    <>
      <td className="num">{h(r.activeHours)}</td><td className="num">{h(r.idleHours)}</td><td className="num">{h(r.breakHours)}</td>
      <td className="num">{h(r.productiveHours)}</td><td className="num">{h(r.unproductiveHours)}</td><td className="num">{pct(r.productivity)}</td>
    </>
  );
  const heads = <><th className="num">Active</th><th className="num">Idle</th><th className="num">Break</th><th className="num">Productive</th><th className="num">Unproductive</th><th className="num">Score</th></>;
  return (
    <>
      <RangeBar from={from} to={to} setFrom={setFrom} setTo={setTo}>
        <Combo value={view} onChange={(e) => setView(e.target.value)} aria-label="Report">
          <option value="employee">Per employee</option>
          <option value="daily">Day by day (login, logout)</option>
          <option value="team">Per department</option>
        </Combo>
        <Combo value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {((data && data.departments) || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Combo>
        <span style={{ marginLeft: 'auto' }}><ExportMenu url="/monitoring/reports" params={{ from, to, department, view }} label="Export" /></span>
      </RangeBar>
      {error && <div className="notice red">{error}</div>}
      <div className="tbl-wrap">
        <table className="mon-table">
          <thead>
            {view === 'team' && <tr><th>Department</th><th className="num">Employees</th>{heads}</tr>}
            {view === 'daily' && <tr><th>Date</th><th>Employee</th><th>Login</th><th>Logout</th>{heads}</tr>}
            {view === 'employee' && <tr><th>Employee</th><th>Department</th><th className="num">Days</th>{heads}</tr>}
          </thead>
          <tbody>
            {view === 'team' && rows.map((r) => <tr key={r.key}><td><b>{r.name}</b></td><td className="num">{r.employees}</td>{nums(r)}</tr>)}
            {view === 'daily' && rows.map((r) => <tr key={r.key} className="row-link" onClick={() => onOpen(r.employeeId)}><td style={{ whiteSpace: 'nowrap' }}>{r.day}</td><td><b>{r.name}</b>{r.department && <div className="small-muted">{r.department}</div>}</td><td>{tm(r.login)}</td><td>{tm(r.logout)}</td>{nums(r)}</tr>)}
            {view === 'employee' && rows.map((r) => <tr key={r.key} className="row-link" onClick={() => onOpen(r.employeeId)}><td><b>{r.name}</b>{r.code && <div className="small-muted">{r.code}</div>}</td><td>{r.department || '—'}</td><td className="num">{r.days}</td>{nums(r)}</tr>)}
            {data && !rows.length && !loading && <tr><td colSpan={10} className="small-muted">No activity in these days.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Devices
function Devices({ manage = false }) {
  const { data, error, reload } = useGet('/monitoring/devices');
  const [msg, setMsg] = useState('');
  async function off(d) {
    if (!window.confirm(`Stop ${d.deviceName}${manage && d.employee ? ` (${d.employee.name})` : ''} from sending activity?`)) return;
    try { const r = await api.put(`/monitoring/devices/${d.id}/deactivate`); setMsg(r.data.message); reload(); } catch (e) { setMsg(errOf(e, 'Could not switch it off.')); }
  }
  const rows = (data && data.rows) || [];
  return (
    <>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="notice red">{error}</div>}
      <div className="tbl-wrap">
        <table className="mon-table">
          <thead><tr>{manage && <th>Employee</th>}<th>PC</th><th>System</th><th>Agent</th><th>Registered</th><th>Last seen</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                {manage && <td><b>{d.employee ? d.employee.name : '—'}</b>{d.employee && d.employee.department && <div className="small-muted">{d.employee.department}</div>}</td>}
                <td>{d.deviceName}</td>
                <td className="small-muted">{d.os || '—'}</td>
                <td className="small-muted">{d.agentVersion || '—'}</td>
                <td>{dt(d.registeredAt)}</td>
                <td>{dt(d.lastSeenAt)}</td>
                <td>{!d.isActive ? <Pill tone="slate">Switched off</Pill> : d.online ? <Pill tone="green">Online</Pill> : <Pill tone="amber">Offline</Pill>}</td>
                <td>{d.isActive && <button type="button" className="btn btn-sm" onClick={() => off(d)}>Deactivate</button>}</td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={manage ? 8 : 7} className="small-muted">No PC registered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Setting up a PC (Settings, My activity)
// A one-time code to type into the agent instead of a password. HR / Admin pick the employee; anyone else gets their own.
function SetUpCode({ pick = false }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [who, setWho] = useState(null);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!pick || q.trim().length < 2 || (who && who.name === q)) { setFound([]); return undefined; }
    const t = setTimeout(() => { api.get('/monitoring/people', { params: { q } }).then((r) => setFound(r.data.rows || [])).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [q, pick]); // eslint-disable-line react-hooks/exhaustive-deps
  async function make() {
    setErr(''); setOut(null);
    try { const r = await api.post('/monitoring/setup-code', pick ? { employeeId: who.id } : {}); setOut(r.data); } catch (e) { setErr(errOf(e, 'Could not make a code.')); }
  }
  return (
    <div className="mon-code">
      <b>Set-up code</b>
      <div className="small-muted">{pick ? 'No password needed: make a code for the employee and type it into the agent.' : 'No password needed: type this code into the agent.'} One use, 30 minutes.</div>
      {pick && (
        <div className="mon-bar" style={{ margin: '8px 0 0' }}>
          <input type="search" placeholder="Search the employee's name or code" value={q} onChange={(e) => { setQ(e.target.value); setWho(null); setOut(null); }} aria-label="Employee" />
        </div>
      )}
      {pick && found.length > 0 && !who && (
        <ul className="mon-pick">
          {found.map((e) => <li key={e.id}><button type="button" className="btn btn-sm btn-ghost" onClick={() => { setWho(e); setQ(e.name); setFound([]); }}>{e.name}<span className="small-muted">{[e.employeeCode, e.department].filter(Boolean).map((x) => ` · ${x}`).join('')}</span></button></li>)}
        </ul>
      )}
      <button type="button" className="btn" style={{ marginTop: 8 }} disabled={pick && !who} onClick={make}>{pick ? 'Make the code' : 'Get my code'}</button>
      {err && <div className="notice red" style={{ marginTop: 8 }}>{err}</div>}
      {out && <div className="mon-code-box"><span>{out.code}</span><div className="small-muted">{`For ${out.employee}. The employee reads and accepts the notice themself on the PC.`}</div></div>}
    </div>
  );
}

function SetUpPc({ pick = false }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function download() {
    setBusy(true); setErr('');
    try {
      const r = await api.get('/monitoring/agent', { responseType: 'blob' });
      const href = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = href; a.download = 'TeamLinkMonitorSetup.cmd'; document.body.appendChild(a); a.click();
      a.remove(); setTimeout(() => URL.revokeObjectURL(href), 2000);
    } catch { setErr('Could not download the file. Please try again.'); } finally { setBusy(false); }
  }
  return (
    <Panel title="Setting up an office PC" sub="Windows only. Takes about a minute on each PC.">
      <ol className="mon-steps">
        <li>On the office PC, sign in to TeamLink and press <b>Download the PC agent</b>. If the browser warns about the file, choose <b>Keep</b>.</li>
        <li>Double-click the downloaded file <b>TeamLinkMonitorSetup.cmd</b>. If Windows shows a blue box, press <b>More info</b> → <b>Run anyway</b>.</li>
        <li>Type the <b>set-up code</b> below into the agent, or sign in with the employee&apos;s own TeamLink email and password.</li>
        <li>The employee reads the notice and accepts it.</li>
        <li>Done. A TeamLink icon stays next to the clock, it starts with Windows, and the PC appears under <b>Devices</b>.</li>
      </ol>
      <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={download}>{busy ? 'Downloading…' : 'Download the PC agent'}</button>
      {err && <div className="notice red" style={{ marginTop: 8 }}>{err}</div>}
      <SetUpCode pick={pick} />
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ Settings
function Settings() {
  const { data, error } = useGet('/monitoring/settings');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm({ workStart: data.workStart, workEnd: data.workEnd, breakStart: data.breakStart || '', breakEnd: data.breakEnd || '', idleThresholdMinutes: data.idleThresholdMinutes, retentionDays: data.retentionDays, policyText: data.policyText }); }, [data]);
  if (error) return <div className="notice red">{error}</div>;
  if (!form) return <div className="small-muted">Loading…</div>;
  async function save() {
    setBusy(true); setMsg(''); setErr('');
    try { const r = await api.put('/monitoring/settings', form); setMsg(r.data.message || 'Saved.'); } catch (e) { setErr(errOf(e, 'Could not save.')); } finally { setBusy(false); }
  }
  return (
    <div className="mon-settings">
      <Panel title="Work hours and records">
        <div className="mon-grid">
          <label>Work starts <input type="time" value={form.workStart} onChange={(e) => setForm({ ...form, workStart: e.target.value })} /></label>
          <label>Work ends <input type="time" value={form.workEnd} onChange={(e) => setForm({ ...form, workEnd: e.target.value })} /></label>
          <label>Lunch break starts <input type="time" value={form.breakStart} onChange={(e) => setForm({ ...form, breakStart: e.target.value })} /></label>
          <label>Lunch break ends <input type="time" value={form.breakEnd} onChange={(e) => setForm({ ...form, breakEnd: e.target.value })} /></label>
          <label>Idle after (minutes with no mouse or keyboard) <input type="number" min={1} max={60} value={form.idleThresholdMinutes} onChange={(e) => setForm({ ...form, idleThresholdMinutes: e.target.value })} /></label>
          <label>Keep records for (days) <input type="number" min={7} max={730} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: e.target.value })} /></label>
        </div>
        <div className="small-muted">Only work hours (India time) are recorded; anything outside them is thrown away. The lunch break counts as Break, not idle, and keeps no app details. Older records are deleted by themselves. Screenshots: <b>off</b> - TeamLink never takes screenshots or reads what is typed.</div>
      </Panel>
      <Panel title={`Consent notice (version ${data.policyVersion})`} sub="Every employee reads and accepts this before anything is recorded. Changing it makes a new version that everyone accepts again.">
        <textarea rows={10} value={form.policyText} onChange={(e) => setForm({ ...form, policyText: e.target.value })} aria-label="Consent notice" style={{ width: '100%' }} />
      </Panel>
      <SetUpPc pick />
      {msg && <div className="notice green">{msg}</div>}
      {err && <div className="notice red">{err}</div>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ My activity
function Mine({ me }) {
  const d = me.data;
  const [msg, setMsg] = useState('');
  async function accept() {
    try { const r = await api.post('/monitoring/me/consent', { policyVersion: d.settings.policyVersion }); setMsg(r.data.message); me.reload(); } catch (e) { setMsg(errOf(e, 'Could not save.')); }
  }
  if (!d.hasEmployee) return <div className="notice">Your login has no employee record, so nothing is recorded for you.</div>;
  const last = d.consents[0];
  return (
    <>
      <Panel title="The monitoring notice" sub={d.accepted ? `You accepted version ${d.settings.policyVersion}${last ? ` on ${dt(last.acceptedAt)}` : ''}.` : 'You have not accepted the current notice. Nothing is recorded on your PC until you do.'}>
        <div className="mon-policy">{d.policyText}</div>
        {!d.accepted && <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={accept}>I have read it and I accept</button>}
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </Panel>
      <h3 className="mon-h3">My activity</h3>
      <EmployeeDetail id="me" own />
      <h3 className="mon-h3">My PCs</h3>
      <Devices />
      <div style={{ marginTop: 14 }}><SetUpPc /></div>
    </>
  );
}
