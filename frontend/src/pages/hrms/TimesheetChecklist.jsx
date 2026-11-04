import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import Combo from '../../components/Combo.jsx';
import { AiAssist } from '../../components/ComposeForm.jsx';

// ---------------------------------------------------------------------------
// Timesheet > Checklist (founder 2026-11-03). Each person writes what they did: the day (today by default), from / to time,
// status (Completed, Pending, In Progress) and a description, then Save. They see their own list; a TL also sees their team;
// the Super Admin sees everyone, department by department. Only the writer can change or remove a row.
// Backend: routes/timesheetChecklist.js.
// ---------------------------------------------------------------------------
const TONE = { Completed: 'active', Pending: 'pending', 'In Progress': 'info' };
const EMPTY = { fromTime: '', toTime: '', status: 'In Progress', description: '' };

function EntryForm({ statuses, initial, date, onSaved, onCancel }) {
  const [f, setF] = useState(initial || EMPTY);
  const [day, setDay] = useState(initial?.date || date);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = { date: day, fromTime: f.fromTime, toTime: f.toTime, status: f.status, description: f.description };
      if (initial?.id) await api.put(`/timesheet-checklist/${initial.id}`, body); else await api.post('/timesheet-checklist', body);
      if (!initial?.id) setF(EMPTY);
      onSaved(initial?.id ? 'Saved.' : 'Added to your checklist.');
    } catch (e) { setErr(e.response?.data?.error || 'Could not save.'); } finally { setBusy(false); }
  }
  return (
    <div className="tcl-form">
      <label>Date<input type="date" value={day} max={new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} /></label>
      <label>From<input type="time" value={f.fromTime} onChange={set('fromTime')} /></label>
      <label>To<input type="time" value={f.toTime} onChange={set('toTime')} /></label>
      <label>Status
        <select value={f.status} onChange={set('status')}>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </label>
      <label className="tcl-desc">What did you do?<textarea rows={4} value={f.description} onChange={set('description')} placeholder="For example: called 20 candidates for the Staff Nurse requirement" /></label>
      {/* the same AI Assist as Timesheet (founder 2026-11-04): fixes the words of the description; nothing is saved until Save */}
      <AiAssist kind="checklist" title={`Work done${f.fromTime && f.toTime ? ` ${f.fromTime} to ${f.toTime}` : ''} (${f.status})`} text={f.description} onText={(t) => setF((x) => ({ ...x, description: t }))} />
      <div className="tcl-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save'}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  );
}

function Rows({ rows, showWho, showDate, statuses, onChanged, setError }) {
  const [editing, setEditing] = useState(null);
  async function remove(r) {
    if (!window.confirm(`Remove this checklist entry (${r.fromTime} to ${r.toTime})?`)) return;
    try { await api.delete(`/timesheet-checklist/${r.id}`); onChanged('Removed.'); } catch (e) { setError(e.response?.data?.error || 'Could not remove.'); }
  }
  if (!rows.length) return <div className="small-muted" style={{ padding: '8px 0' }}>Nothing written for this day yet.</div>;
  return (
    <table className="table tcl-table">
      <thead><tr>{showWho && <th>Employee</th>}{showDate && <th>Day</th>}<th>From</th><th>To</th><th>Status</th><th>What was done</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (editing === r.id ? (
          <tr key={r.id}><td colSpan={(showWho ? 6 : 5) + (showDate ? 1 : 0)}>
            <EntryForm statuses={statuses} initial={r} date={r.date} onCancel={() => setEditing(null)} onSaved={(m) => { setEditing(null); onChanged(m); }} />
          </td></tr>
        ) : (
          <tr key={r.id}>
            {showWho && <td><b>{r.name}</b><div className="small-muted">{r.employeeCode}{r.team ? ` · ${r.team}` : ''}</div></td>}
            {showDate && <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>}
            <td>{r.fromTime}</td>
            <td>{r.toTime}</td>
            <td><span className={`status ${TONE[r.status] || ''}`}>{r.status}</span></td>
            <td style={{ whiteSpace: 'pre-wrap' }}>{r.description}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {r.mine && <><button type="button" className="btn btn-sm" onClick={() => setEditing(r.id)}>Edit</button>{' '}
                <button type="button" className="btn btn-sm" onClick={() => remove(r)}>Remove</button></>}
            </td>
          </tr>
        )))}
      </tbody>
    </table>
  );
}

export default function TimesheetChecklist() {
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [department, setDepartment] = useState('');
  const [userId, setUserId] = useState('');
  const [to, setTo] = useState(''); // empty = the one day picked
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [qSent, setQSent] = useState('');
  useEffect(() => { const t = setTimeout(() => setQSent(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.get('/timesheet-checklist', { params: { date, to: to || undefined, status: status || undefined, q: qSent || undefined, department: department || undefined, userId: userId || undefined } })
      .then((res) => { setData(res.data); setError(''); })
      .catch((e) => setError(e.response?.data?.error || 'Could not load the checklist.'));
  }, [date, to, status, qSent, department, userId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="small-muted">{error || 'Loading...'}</div>;
  const others = data.scope !== 'self';
  const range = !!data.to && data.to !== data.date; // more than one day shown: a Day column
  const mineRows = data.rows.filter((r) => r.mine);
  const teamRows = data.rows.filter((r) => !r.mine);
  const people = data.people.filter((p) => !department || p.department === department);
  const changed = (m) => { setNotice(m); load(); };
  // The Super Admin's list: department by department.
  const groups = [...new Set(teamRows.map((r) => r.department))].sort().map((d) => ({ d, rows: teamRows.filter((r) => r.department === d) }));

  return (
    <div className="tcl">
      {error && <div className="error-text">{error}</div>}
      {notice && <div className="tt-notice-ok" role="status">{notice}</div>}

      {/* FILTERS ON TOP (founder 2026-11-04): days From - To, status, words, and (for leads) department / employee */}
      <div className="tcl-bar">
        <label>From<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></label>
        <label>To<input type="date" value={to} min={date} max={today} onChange={(e) => setTo(e.target.value || '')} /></label>
        <label>Status
          <Combo value={status} onChange={(e) => setStatus(e.target.value || '')}>
            <option value="">Any status</option>
            {(data.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </Combo>
        </label>
        <label>Search<input type="search" value={q} placeholder="Words in what was done, or a name" onChange={(e) => setQ(e.target.value)} /></label>
        {(to || status || q || department || userId) && <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => { setTo(''); setStatus(''); setQ(''); setDepartment(''); setUserId(''); setDate(today); }}>Clear filters</button>}
        {others && data.scope === 'all' && (
          <label>Department
            <Combo value={department} onChange={(e) => { setDepartment(e.target.value || ''); setUserId(''); }}>
              <option value="">All departments</option>
              {data.departments.map((d) => <option key={d.department} value={d.department}>{`${d.department} (${d.count})`}</option>)}
            </Combo>
          </label>
        )}
        {others && (
          <label>Employee
            <Combo value={userId} onChange={(e) => setUserId(e.target.value || '')} departments={false}>
              <option value="">{data.scope === 'all' ? 'Everyone' : 'My whole team'}</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{`${p.name} · ${p.employeeCode}`}</option>)}
            </Combo>
          </label>
        )}
      </div>

      {data.canWrite && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head"><h3>My checklist{range ? ` · ${date} to ${data.to}` : (date === data.today ? ' today' : ` · ${date}`)}</h3></div>
          <div className="panel-pad">
            <EntryForm statuses={data.statuses} date={date} onSaved={changed} />
            <Rows rows={mineRows} showWho={false} showDate={range} statuses={data.statuses} onChanged={changed} setError={setError} />
          </div>
        </div>
      )}

      {others && (
        <div className="panel">
          <div className="panel-head"><h3>{data.scope === 'all' ? 'Everyone, department-wise' : 'My team'} <span className="small-muted">({teamRows.length})</span></h3></div>
          <div className="panel-pad">
            {data.scope === 'all'
              ? (groups.length ? groups.map((g) => (
                <div key={g.d} className="tcl-group">
                  <div className="tcl-group-head">{g.d} <span className="small-muted">({g.rows.length})</span></div>
                  <Rows rows={g.rows} showWho showDate={range} statuses={data.statuses} onChanged={changed} setError={setError} />
                </div>
              )) : <div className="small-muted">Nobody has written a checklist for this day yet.</div>)
              : <Rows rows={teamRows} showWho showDate={range} statuses={data.statuses} onChanged={changed} setError={setError} />}
          </div>
        </div>
      )}
    </div>
  );
}
