import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import '../clients/followUpLog.css';

// THE TEAM'S FOLLOW-UP HISTORY (founder 2026-11-03: "ah history antha respective tls ki kanipinchali"). Reports & Team -> Team
// -> Follow-up history: every follow-up the people of my team wrote, day by day - candidate and client comments, the calls /
// mails logged with "Follow up" and follow-up tasks marked done. A TL sees their own team, the BDE TL the BDEs, Admin and
// Manager everyone, a recruiter only their own (the server decides: GET /client-followlog/team).
const fmtDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y) return ymd || '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const minus = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const SOURCE = { quick: 'Logged contact', task: 'Follow-up task', manual: 'Comment' };

export default function TeamFollowUpHistory() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [personId, setPersonId] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/client-followlog/team', { params: { from: range.from || undefined, to: range.to || undefined, personId: personId || undefined } })
      .then((r) => { setData(r.data); setError(''); if (!range.from) setRange({ from: r.data.from, to: r.data.to }); })
      .catch((e) => setError(e.response?.data?.error || 'The follow-up history could not be loaded.'))
      .finally(() => setLoading(false));
  }, [range.from, range.to, personId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const out = [];
    data.rows
      .filter((r) => (!kind || r.kind === kind) && (!needle || `${r.name} ${r.note} ${r.about || ''} ${r.byName || ''}`.toLowerCase().includes(needle)))
      .forEach((r) => { const last = out[out.length - 1]; if (last && last.day === r.onDate) last.rows.push(r); else out.push({ day: r.onDate, rows: [r] }); });
    return out;
  }, [data, kind, q]);

  const today = data ? data.today : '';
  const quick = (days) => setRange({ from: minus(today, days - 1), to: today });
  const mine = data && data.scope === 'mine';

  return (
    <div className="card section flog">
      <div>
        <h3 style={{ margin: 0 }}>{mine ? 'My follow-up history' : 'Follow-up history of my team'}</h3>
        <div className="small-muted">
          {mine ? 'Every follow-up you wrote or logged, day by day.' : 'Who followed up with which candidate or client, day by day: comments, logged calls and mails, and follow-up tasks done.'}
        </div>
      </div>

      <div className="flog-filters">
        <label className="small-muted">From <input type="date" value={range.from} max={range.to || today} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label className="small-muted">To <input type="date" value={range.to} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        {today && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => quick(1)}>Today</button>
            <button type="button" className="btn btn-sm" onClick={() => quick(7)}>7 days</button>
            <button type="button" className="btn btn-sm" onClick={() => quick(30)}>30 days</button>
          </>
        )}
      </div>
      <div className="flog-filters">
        {!mine && data && (
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Person">
            <option value="">Everyone in my team</option>
            {data.people.map((p) => <option key={p.id} value={p.id}>{`${p.name}${p.role ? ` (${p.role})` : ''}`}</option>)}
          </select>
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Candidates or clients">
          <option value="">Candidates and clients</option>
          <option value="Candidate">Candidates only</option>
          <option value="Client">Clients only</option>
        </select>
        <input type="search" value={q} placeholder="Search a name or what was said…" onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && !data && <div className="small-muted">Loading…</div>}

      {data && !mine && (
        <div className="flog-imp-wrap" style={{ maxHeight: 'none' }}>
          <table className="flog-imp-table">
            <thead><tr><th>Person</th><th>Follow-ups</th><th>Candidates</th><th>Clients</th><th>Days with a follow-up</th><th>Last one</th></tr></thead>
            <tbody>
              {data.summary.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setPersonId(personId === s.id ? '' : s.id)} title="Show only this person (click again for everyone)">
                  <td><b>{s.name}</b>{s.role ? <span className="small-muted">{` · ${s.role}`}</span> : null}</td>
                  <td>{s.total}</td>
                  <td>{s.candidates}</td>
                  <td>{s.clients}</td>
                  <td>{s.days}</td>
                  <td>{s.last ? fmtDay(s.last) : <span className="flog-none">None in these days</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flog-list">
          {groups.map((g) => (
            <div key={g.day} className="flog-day">
              <div className="flog-dayhead">{`${fmtDay(g.day)} · ${g.rows.length}`}</div>
              {g.rows.map((r) => (
                <div key={r.id} className="flog-row">
                  <div className="flog-text"><Link to={r.link}><b>{r.name}</b></Link>{` — ${r.note}`}</div>
                  <div className="flog-meta">
                    <span><b>{r.byName || 'Someone'}</b>{r.byRole ? ` (${r.byRole})` : ''}</span>
                    <span className="flog-req">{r.kind}</span>
                    {r.source !== 'manual' && <span className="flog-tag">{SOURCE[r.source] || r.source}</span>}
                    {r.about && <span className="flog-req">{r.about}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="small-muted">No follow-up in these days.</div>}
        </div>
      )}
    </div>
  );
}
