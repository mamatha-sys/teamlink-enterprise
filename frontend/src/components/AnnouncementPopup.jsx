import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from './Modal.jsx';
import NoticeMedia from './NoticeMedia.jsx';
import { JoinMeeting } from './MeetingLink.jsx';

// ---------------------------------------------------------------------------
// A NEW ANNOUNCEMENT COMES UP ON SCREEN (founder 2026-11-06: "the announcement is popup so that every employee knows"). Mounted once, in Shell.jsx.
// It shows each notice this person has not read yet (GET /announcements/popup, every minute), one at a time. OK marks it read for them on every
// computer, the same as opening it in the bell, so it never comes back. Someone who was away sees it at their next login.
// ---------------------------------------------------------------------------
const POLL_MS = 60000;

export default function AnnouncementPopup() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!user) return undefined;
    const check = () => {
      api.get('/announcements/popup').then((r) => { if (alive.current) setItems(r.data || []); }).catch(() => { /* offline: try again later */ });
    };
    check();
    const timer = setInterval(() => { if (!document.hidden) check(); }, POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = items[0];
  if (!a) return null;

  async function ok() {
    setBusy(true);
    await api.post(`/announcements/${a.id}/seen`).catch(() => null);
    setItems((list) => list.filter((x) => x.id !== a.id));
    setBusy(false);
  }

  return (
    <Modal title={a.title} note={[a.category || 'General', a.postedBy && `from ${a.postedBy}`, items.length > 1 && `1 of ${items.length}`].filter(Boolean).join(' · ')} onClose={ok}>
      <div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
      {a.media && <NoticeMedia key={a.id} a={a} />}
      {a.meetingLink && <div style={{ marginTop: 10 }}><JoinMeeting href={a.meetingLink} when={a.meetingWhen} /></div>}
      <div style={{ marginTop: 14, textAlign: 'right' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={ok}>OK, got it</button>
      </div>
    </Modal>
  );
}
