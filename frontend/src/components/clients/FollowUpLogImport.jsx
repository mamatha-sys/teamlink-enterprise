import { useRef, useState } from 'react';
import api from '../../api';
import Modal from '../Modal.jsx';

// IMPORT ON THE FOLLOW-UPS TAB (founder 2026-11-04: "ikkada kuda export import button vundali"). A sheet with a date and what
// happened on each line - the file Export gives, or any Excel / CSV whose lines start with a date - is added to THIS log
// (a candidate's, a client's or a requirement's). Preview first: how many new lines, a few of them, and what was left out.
// The server: POST /client-followlog/log-import/preview | /commit (utils/clientFollowLog.js simplePreview / simpleCommit).
const dmy = (ymd) => { const [y, m, d] = String(ymd || '').split('-'); return y ? `${d}-${m}-${y}` : ymd; };

export default function FollowUpLogImport({ params, onDone }) {
  const pick = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  async function choose(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await api.post('/client-followlog/log-import/preview', file, { params, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      setPreview(r.data);
    } catch (err) { setError(err.response?.data?.error || 'This file could not be read.'); setPreview({ failed: true }); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true); setError('');
    try {
      const r = await api.post('/client-followlog/log-import/commit', { token: preview.token });
      setPreview(null);
      onDone(r.data.message || 'Imported.');
    } catch (err) { setError(err.response?.data?.error || 'The import did not finish. Please try again.'); } finally { setBusy(false); }
  }
  const close = () => { setPreview(null); setError(''); };
  const left = preview && !preview.failed ? [
    preview.already ? `${preview.already} already on the follow-ups` : '',
    preview.repeats ? `${preview.repeats} written twice in the file (kept once)` : '',
    preview.undated ? `${preview.undated} without a date or words` : '',
    preview.future ? `${preview.future} with a date that has not come yet` : '',
  ].filter(Boolean) : [];

  return (
    <>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => pick.current && pick.current.click()} title="Add follow-ups from an Excel or CSV file: a date and what happened on each line">
        {busy && !preview ? 'Reading…' : '⤒ Import'}
      </button>
      <input ref={pick} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={choose} />
      {preview && (
        <Modal
          title={preview.failed ? 'Import follow-ups' : `Import ${preview.count} follow-up${preview.count === 1 ? '' : 's'}`}
          onClose={close}
          footer={(
            <>
              <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
              {!preview.failed && <button type="button" className="btn btn-primary" onClick={commit} disabled={busy}>{busy ? 'Importing…' : `Import ${preview.count}`}</button>}
            </>
          )}
        >
          {error && <div className="notice red">{error}</div>}
          {preview.failed ? (
            <div className="small-muted">Each line needs a date (like 04-11-2026) and what happened. The file from Export has the right columns: Date, What happened, Who.</div>
          ) : (
            <>
              <div className="small-muted" style={{ marginBottom: 6 }}>{`From ${preview.fileName}. They will show "From the sheet" on the list.`}</div>
              <ul style={{ margin: '0 0 6px', paddingLeft: 18, lineHeight: 1.6 }}>
                {preview.sample.map((l, i) => <li key={i}><b>{dmy(l.onDate)}</b>{` — ${l.note.slice(0, 140)}${l.who ? ` (${l.who})` : ''}`}</li>)}
              </ul>
              {preview.count > preview.sample.length && <div className="small-muted">{`…and ${preview.count - preview.sample.length} more.`}</div>}
              {left.length > 0 && <div className="small-muted" style={{ marginTop: 6 }}>{`Left out: ${left.join('; ')}.`}</div>}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
