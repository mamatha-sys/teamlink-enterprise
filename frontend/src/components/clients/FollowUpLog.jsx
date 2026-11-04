import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import './followUpLog.css';

// THE CLIENT'S FOLLOW-UP LOG (founder 2026-11-03: "comments option recruiters ki, tls ki, bde ki andhariki vundali. vallu ey
// roju followup chesaro teluskovadaniki"). One dated line per follow-up - who did it, on which day, what happened - the same
// log on the client page and on every requirement page of that client. Lines imported from the BDE desk's Excel sheet
// carry a "From the sheet" tag. The server (routes/clientFollowLog.js) decides who may read and who may write.
const fmtDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y) return ymd || '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const PAGE = 40; // days shown at a time

// candidateId (2026-11-03: "recruiters ki ithey, candidate follow up vundali"): the same log on the candidate profile, with the
// calls / mails logged from "Follow up" and the follow-up tasks marked done; applicationId tags a new line with that job.
export default function FollowUpLog({ clientId, requirementId, candidateId, applicationId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [onDate, setOnDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(PAGE);
  const params = candidateId ? { candidateId } : requirementId ? { requirementId } : { clientId };

  function load() {
    api.get('/client-followlog', { params })
      .then((r) => { setData(r.data); setError(''); setOnDate((d) => d || r.data.today); })
      .catch((e) => { setData(null); setError(e.response?.data?.error || 'The follow-ups could not be loaded.'); });
  }
  useEffect(load, [clientId, requirementId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (note.trim().length < 3) { setError('Write what happened in the follow-up.'); return; }
    setBusy(true); setError(''); setFlash('');
    try {
      const r = await api.post('/client-followlog', { ...params, ...(candidateId && applicationId ? { applicationId } : {}), onDate, note: note.trim() });
      setNote(''); setFlash(r.data?.message || 'Saved.'); load();
    } catch (e) { setError(e.response?.data?.error || 'That did not save. Please try again.'); } finally { setBusy(false); }
  }

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const rows = data.entries.filter((e) => (!who || e.byName === who || (who === '__sheet' && e.source === 'sheet'))
      && (!needle || `${e.note} ${e.topic || ''} ${e.byName || ''}`.toLowerCase().includes(needle)));
    const out = [];
    rows.forEach((e) => {
      const last = out[out.length - 1];
      if (last && last.day === e.onDate) last.rows.push(e); else out.push({ day: e.onDate, rows: [e] });
    });
    return out;
  }, [data, who, q]);

  if (!data) return <div className="card section">{error ? <div className="error-text">{error}</div> : <div className="small-muted">Loading the follow-ups…</div>}</div>;
  const sheetRows = data.entries.filter((e) => e.source === 'sheet').length;
  const shownRows = groups.slice(0, days).reduce((n, g) => n + g.rows.length, 0);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="card section flog">
      <div className="flog-head">
        <div>
          <h3 style={{ margin: 0 }}>Follow-ups — {data.client.name}</h3>
          <div className="small-muted">
            {data.entries.length ? `${data.entries.length} follow-up${data.entries.length === 1 ? '' : 's'}; the last one on ${fmtDay(data.lastOn)}.` : 'No follow-up written yet.'}
            {' '}{candidateId ? 'Everyone who works this candidate, and their TL, sees the same list.' : `Everyone who works this client sees the same list${data.requirement ? ' (also on the client page)' : ''}.`}
          </div>
        </div>
      </div>

      {data.canAdd && (
        <div className="flog-add">
          <label className="flog-date">
            <span>Follow-up date</span>
            <input type="date" value={onDate} max={data.today} onChange={(e) => setOnDate(e.target.value)} />
          </label>
          <label className="flog-note">
            <span>What happened?</span>
            <textarea rows="2" value={note} maxLength={2000} placeholder={candidateId ? 'Called the candidate: interested, will attend the interview on Monday' : 'Called the HOD: 5 interviews scheduled for tomorrow at 10:30'} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add follow-up'}</button>
        </div>
      )}
      {flash && <div className="flog-flash" role="status">{flash}</div>}
      {error && <div className="error-text">{error}</div>}

      {data.entries.length > 0 && (
        <div className="flog-filters">
          <select value={who} onChange={(e) => { setWho(e.target.value); setDays(PAGE); }} aria-label="Who">
            <option value="">Everyone</option>
            {data.people.map((p) => <option key={p} value={p}>{p}</option>)}
            {sheetRows > 0 && <option value="__sheet">Only the lines from the sheet</option>}
          </select>
          <input type="search" value={q} placeholder="Search the follow-ups…" onChange={(e) => { setQ(e.target.value); setDays(PAGE); }} />
          <span className="small-muted">{totalRows === data.entries.length ? '' : `${totalRows} of ${data.entries.length}`}</span>
        </div>
      )}

      <div className="flog-list">
        {groups.slice(0, days).map((g) => (
          <div key={g.day} className="flog-day">
            <div className="flog-dayhead">{fmtDay(g.day)}</div>
            {g.rows.map((e) => (
              <div key={e.id} className="flog-row">
                <div className="flog-text">{e.note}</div>
                <div className="flog-meta">
                  {e.source === 'sheet'
                    ? <span className="flog-tag">From the sheet{e.topic ? ` · ${e.topic}` : ''}</span>
                    : <span><b>{e.byName || 'Someone'}</b>{e.byRole ? ` (${e.byRole})` : ''}</span>}
                  {e.source === 'quick' && <span className="flog-tag">{`Logged ${e.topic === 'Call' ? 'call' : (e.topic || '').toLowerCase()}`}</span>}
                  {e.source === 'task' && <span className="flog-tag">Follow-up task</span>}
                  {e.requirementLabel && <span className="flog-req">{e.requirementLabel}</span>}
                </div>
              </div>
            ))}
          </div>
        ))}
        {groups.length === 0 && data.entries.length > 0 && <div className="small-muted">No follow-up matches.</div>}
      </div>
      {groups.length > days && (
        <button type="button" className="btn btn-sm" onClick={() => setDays((d) => d + PAGE)}>{`Show more (${totalRows - shownRows} older)`}</button>
      )}
    </div>
  );
}
