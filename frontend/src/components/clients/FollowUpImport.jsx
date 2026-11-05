import { useMemo, useState } from 'react';
import api from '../../api';
import Modal from '../Modal.jsx';
import './followUpLog.css';

// IMPORT FOLLOW-UPS FROM AN EXCEL SHEET (founder 2026-11-03: the BDE desk's "Edu - 1 Requirement Sheet"): one college per row,
// every line that starts with a date ("02-11-2022 - interviews 4") becomes one follow-up of that client. Step 1 the file,
// step 2 check which TeamLink client each college is (same name -> picked; similar -> "Check"; none -> pick or skip),
// step 3 import. Importing the same sheet again adds only the new lines.
export function FollowUpImportButton({ onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" title="Import the dated follow-up lines of an Excel sheet into each client's Follow-ups" onClick={() => setOpen(true)}>⤓ Import follow-ups</button>
      {open && <FollowUpImport onClose={() => setOpen(false)} onDone={(m) => { setOpen(false); onDone?.(m); }} />}
    </>
  );
}

export default function FollowUpImport({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [prev, setPrev] = useState(null);
  const [map, setMap] = useState({});
  const [other, setOther] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const byName = useMemo(() => new Map((prev?.clients || []).map((c) => [c.name.toLowerCase(), c.id])), [prev]);

  async function check() {
    if (!file) { setError('Choose the Excel file.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post('/client-followlog/import/preview', file, { headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      setPrev(r.data);
      setMap(Object.fromEntries(r.data.colleges.map((c) => [c.index, c.pick || ''])));
    } catch (e) { setError(e.response?.data?.error || 'The file could not be checked.'); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true); setError('');
    try {
      const r = await api.post('/client-followlog/import/commit', { token: prev.token, mapping: map });
      setResult(r.data);
    } catch (e) { setError(e.response?.data?.error || 'The import did not finish. Please try again.'); } finally { setBusy(false); }
  }

  const chosen = prev ? prev.colleges.filter((c) => map[c.index]) : [];
  const lines = chosen.reduce((n, c) => n + c.lines, 0);
  const pick = (c, v) => {
    if (v === '__other') { setOther((o) => ({ ...o, [c.index]: true })); setMap((m) => ({ ...m, [c.index]: '' })); return; }
    setOther((o) => ({ ...o, [c.index]: false })); setMap((m) => ({ ...m, [c.index]: v }));
  };

  let footer;
  if (result) footer = <button type="button" className="btn btn-primary" onClick={() => onDone?.(result.message)}>Done</button>;
  else if (prev) {
    footer = (
      <>
        <button type="button" className="btn" onClick={() => { setPrev(null); setMap({}); }}>Back</button>
        <button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={commit}>{busy ? 'Importing…' : `Import ${lines.toLocaleString('en-IN')} follow-ups into ${chosen.length} clients`}</button>
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !file} onClick={check}>{busy ? 'Reading the file…' : 'Check the file'}</button>
      </>
    );
  }

  return (
    <Modal title="Import follow-ups from Excel" size="xwide" onClose={onClose} footer={footer}>
      {result ? (
        <div className="flog">
          <div className="flog-flash" role="status">{result.message}</div>
          {result.skipped > 0 && <div className="small-muted">{`${result.skipped} lines were skipped (colleges set to "Skip").`}</div>}
          {result.refused?.length > 0 && <div className="error-text">{`Not yours, so not imported: ${result.refused.join(', ')}`}</div>}
          <div className="small-muted">Open a client and press the Follow-ups tab to see them, under their sub tabs.</div>
        </div>
      ) : !prev ? (
        <div className="flog">
          <div>Every tab of the file is read: client rows go to Client follow-up, Schedule and Interview tabs to theirs, and a client's Running / Stopped status is picked up. Every line that starts with a date, like <b>02-11-2022 - interviews 4</b>, becomes one follow-up of that client on that day. Contact, phone, location and mail columns are left as they are.</div>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }} />
          <div className="small-muted">Nothing is saved until you check the clients and press Import. Importing the same sheet again adds only the new lines.</div>
          {error && <div className="error-text">{error}</div>}
        </div>
      ) : (
        <div className="flog">
          <div>
            <b>{prev.fileName}</b>
            {`: ${prev.totalLines.toLocaleString('en-IN')} lines for ${prev.colleges.length} clients. Check the TeamLink client of each one, then press Import.`}
          </div>
          <div className="flog-imp-tabs">
            {prev.tabs.map((t) => <div key={t.name}><b>{t.name}</b>{t.kind ? ` → ${t.kind}: ${t.lines.toLocaleString('en-IN')} lines` : ' → left out: no client in this tab'}</div>)}
            <div className="small-muted">Candidates' CTC and phone numbers are not imported.</div>
          </div>
          {prev.futureCount > 0 && (
            <div className="flog-check">{`${prev.futureCount} line(s) have a date after today (a typo in the sheet) and are not imported: ${prev.futureSamples.slice(0, 3).join(' | ')}`}</div>
          )}
          {prev.undated > 0 && <div className="small-muted">{`${prev.undated} lines have no date (like "No Requirement" or the job list) and are left out.`}</div>}
          <div className="flog-imp-wrap">
            <table className="flog-imp-table">
              <thead><tr><th>College in the sheet</th><th>Lines</th><th>TeamLink client</th><th /></tr></thead>
              <tbody>
                {prev.colleges.map((c) => {
                  const v = map[c.index] || '';
                  const sure = v && v === c.pick && c.score >= 100;
                  return (
                    <tr key={c.index}>
                      <td>{c.name}<div className="small-muted">{[c.from ? `${c.from} → ${c.to}` : 'No dates', c.status].filter(Boolean).join(' · ')}</div></td>
                      <td>{c.lines}</td>
                      <td>
                        {other[c.index] ? (
                          <input
                            list="flog-imp-clients"
                            placeholder="Type the client name"
                            onChange={(e) => setMap((m) => ({ ...m, [c.index]: byName.get(e.target.value.trim().toLowerCase()) || '' }))}
                          />
                        ) : (
                          <select value={v} onChange={(e) => pick(c, e.target.value)}>
                            <option value="">Skip this college</option>
                            {c.suggestions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            <option value="__other">Another client…</option>
                          </select>
                        )}
                      </td>
                      <td>{!v ? <span className="flog-none">Skipped</span> : sure ? <span className="flog-ok">Same name</span> : <span className="flog-check">Check</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="flog-imp-clients">{prev.clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
