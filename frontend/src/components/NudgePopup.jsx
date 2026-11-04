import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Modal from './Modal.jsx';

// ---------------------------------------------------------------------------
// The reminder POPUP (founder 2026-11-04: "popup message ravali timesheet morning and evening and afternoon ... lms kuda course assign
// ithey complete cheyali ani ravali"). The server writes them (utils/dayNudges.js: 10:00, 14:00, 17:30 on working days, and a few
// minutes after a course is given); this asks every 5 minutes and when the tab comes back, shows one at a time, and marks it seen on close.
// "Open: /path" in the note becomes a button to that screen.
// ---------------------------------------------------------------------------
export default function NudgePopup() {
  const [list, setList] = useState([]);
  const navigate = useNavigate();
  const load = useCallback(() => {
    api.get('/nudges/mine').then((r) => setList(r.data.popups || [])).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);
  const cur = list[0];
  if (!cur) return null;
  const lines = String(cur.message || '').split('\n');
  const open = (lines.find((l) => /^Open: \//.test(l)) || '').replace(/^Open: /, '').trim();
  const text = lines.filter((l) => !/^Open: \//.test(l));
  const close = (go) => {
    api.post(`/nudges/${cur.id}/seen`).catch(() => {});
    setList((l) => l.slice(1));
    if (go && open) navigate(open);
  };
  return (
    <Modal
      title={cur.title}
      onClose={() => close(false)}
      footer={(
        <>
          <button type="button" className="btn" onClick={() => close(false)}>Close</button>
          {open && <button type="button" className="btn btn-primary" onClick={() => close(true)}>Open</button>}
        </>
      )}
    >
      {text.map((l, i) => <p key={`${i}-${l.slice(0, 12)}`} style={{ margin: i === 0 ? '0 0 8px' : '0 0 6px', fontWeight: i === 0 ? 600 : 400 }}>{l}</p>)}
    </Modal>
  );
}
