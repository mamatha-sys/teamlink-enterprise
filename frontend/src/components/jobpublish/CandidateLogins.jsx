import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import { useVisiblePoll, when } from './jpKit.js';
import './jobpublish.css';
import './naukriShineMailboxes.css';

// ---------------------------------------------------------------------------
// ADMINISTRATION > INTEGRATIONS > Job Portal settings > "Candidate logins"  (founder, 2026-11-02)
// Every candidate (added here, imported, or brought in from Naukri / Shine) is sent a login for the Job Portal by SMS, email and
// WhatsApp. They see only their own candidate page there: the jobs they applied for and their interview.
//   Automatic sending   a switch (server: utils/candidateLogins.js). New candidates are handled by themselves.
//   Earlier candidates  never sent on their own: the number is shown and the Administrator sends it on purpose.
// A password is never shown here, never stored here and never comes back from the server.
// ---------------------------------------------------------------------------
const errOf = (e) => {
  const x = e && e.response && e.response.data && e.response.data.error;
  return (x && x.message) || (typeof x === 'string' ? x : '') || (e && e.message) || 'That did not work. Please try again.';
};

export default function CandidateLogins() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try { const { data } = await api.get('/candidate-logins'); setD(data); setErr(''); } catch (e) { setErr(errOf(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const running = !!(d && ((d.run && d.run.running) || (d.portal && d.portal.progress && d.portal.progress.running)));
  useVisiblePoll(load, running, 3000);

  async function toggle() {
    setBusy('auto'); setNote(null);
    try { await api.put('/candidate-logins/auto', { on: !d.auto }); await load(); } catch (e) { setNote({ ok: false, text: errOf(e) }); }
    setBusy('');
  }
  async function send() {
    setBusy('send'); setNote(null);
    try {
      await api.post('/candidate-logins/send', { confirm: true, expected: { teamlink: d.backlog.wouldInvite || 0, portal: d.portal.total || 0 } });
      setNote({ ok: true, text: 'Started. The logins are going out one by one. You can leave this page.' });
      setAsk(false);
      await load();
    } catch (e) { setNote({ ok: false, text: errOf(e) }); await load(); }
    setBusy('');
  }

  if (err && !d) return <div className="jp-err" role="alert">{err} <button type="button" className="btn btn-sm" onClick={load}>Try again</button></div>;
  if (!d) return <div className="nsm-hint">Loading…</div>;
  const waitingA = d.backlog && d.backlog.ready ? d.backlog.wouldInvite : 0;
  const waitingB = (d.portal && d.portal.total) || 0;
  const waiting = waitingA + waitingB;
  const r = d.run || {};
  const pp = (d.portal && d.portal.progress) || null;

  return (
    <div className="nsm-wrap">
      <section className="nsm-card">
        <div className="nsm-card-hd"><b>Send the login to every new candidate</b></div>
        <p className="nsm-hint">
          When someone is added, imported, or comes from Naukri or Shine, they get their login by SMS, email and WhatsApp. With it they open the Job Portal
          and see only their own page: the jobs they applied for and their interview. They must set their own password the first time.
        </p>
        <div className="jp-row">
          <span className={d.auto ? 'jp-ok' : 'jp-err'} style={{ margin: 0 }}>{d.auto ? 'ON: new candidates get a login by themselves' : 'OFF: nobody is sent a login'}</span>
          <button type="button" className="btn btn-sm" disabled={busy === 'auto'} onClick={toggle}>{d.auto ? 'Switch off' : 'Switch on'}</button>
        </div>
        {d.lastRunAt && <span className="nsm-hint">Last check: {when(d.lastRunAt)}.{d.last ? ` Last sent: ${when(d.last.at)}.` : ''}{d.waitingRetry ? ` ${d.waitingRetry} will be tried again tomorrow.` : ''}</span>}
      </section>

      <section className="nsm-card">
        <div className="nsm-card-hd"><b>People who are already in the database but never got a login</b></div>
        {d.backlog && d.backlog.error && <div className="jp-err" role="alert">Could not count the TeamLink candidates: {d.backlog.error}</div>}
        {d.portal && d.portal.error && <div className="jp-err" role="alert">Could not count the Job Portal candidates: {d.portal.error}</div>}
        {!(d.backlog && d.backlog.ready) && !(d.backlog && d.backlog.error) && <span className="nsm-hint">The first check has not run yet. Please look again in a few minutes.</span>}
        {(d.backlog && d.backlog.ready) && (
          <ul className="nsm-hint" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>{waitingA}</b> candidates added or imported here</li>
            <li><b>{waitingB}</b> candidates that came from Naukri / Shine mails</li>
          </ul>
        )}
        {(r.running || r.finishedAt) && <div className="jp-ok" style={{ margin: 0 }} role="status">TeamLink candidates: {r.done} of {r.total} done, {r.invited} sent{r.notSent ? `, ${r.notSent} could not be sent` : ''}{r.error ? `. Stopped: ${r.error}` : ''}</div>}
        {pp && (pp.running || pp.finishedAt) && <div className="jp-ok" style={{ margin: 0 }} role="status">Naukri / Shine candidates: {pp.done} of {pp.total} done, {pp.sent} sent{pp.failed ? `, ${pp.failed} could not be sent` : ''}</div>}
        {waiting === 0 && !running ? <span className="nsm-hint">Nobody is waiting.</span> : !ask ? (
          <div className="jp-row"><button type="button" className="btn btn-primary" disabled={running || !waiting} onClick={() => setAsk(true)}>Send logins to {waiting} {waiting === 1 ? 'person' : 'people'}</button></div>
        ) : (
          <div className="jp-row">
            <span className="nsm-hint"><b>{waiting} {waiting === 1 ? 'person' : 'people'}</b> will get a real SMS, email and WhatsApp now. Sure?</span>
            <button type="button" className="btn btn-primary" disabled={busy === 'send'} onClick={send}>{busy === 'send' ? 'Starting…' : `Yes, send to ${waiting}`}</button>
            <button type="button" className="btn" onClick={() => setAsk(false)}>No, go back</button>
          </div>
        )}
        <span className="nsm-hint">People who asked not to be contacted, and people with no email or mobile number, are never sent anything. Nobody is sent a second login.</span>
        {note && <div className={note.ok ? 'jp-ok' : 'jp-err'} role={note.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{note.text}</div>}
      </section>
    </div>
  );
}
