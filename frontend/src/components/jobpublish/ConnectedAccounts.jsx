import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { when } from './jpKit.js';
import './jobpublish.css';
import './naukriShineMailboxes.css';

// ---------------------------------------------------------------------------
// ADMINISTRATION > INTEGRATIONS > Job Portal settings > "Connected accounts"  (founder, 2026-11-02)
// The Job Portal uses the SAME accounts as TeamLink's Integrations, by itself: nothing is entered twice here.
//   WhatsApp      TeamLink's default WhatsApp number is handed to the portal, which sends its messages from it.
//   Social media  the accounts of Integrations > Social Media (a portal job is published to them from the Post step).
//   AI calling    TeamLink's AI calling (the portal's recruiters use it through TeamLink).
// Server: utils/portalIntegrations.js. No token or password is ever on this screen.
// ---------------------------------------------------------------------------
const errOf = (e) => {
  const x = e && e.response && e.response.data && e.response.data.error;
  return (x && x.message) || (typeof x === 'string' ? x : '') || (e && e.message) || 'That did not work. Please try again.';
};
const NAME = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X' };
const tone = (s) => (/connected/i.test(s || '') ? 'jp-ok' : 'jp-err');

export default function ConnectedAccounts() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(async () => {
    try { const { data } = await api.get('/portal-admin/connected'); setD(data); setErr(''); } catch (e) { setErr(errOf(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy(true); setNote(null);
    try {
      const { data } = await api.post('/portal-admin/connected/sync', {});
      setNote(data.pushed || data.unchanged ? { ok: true, text: 'Done. The Job Portal now sends WhatsApp from this number.' } : { ok: false, text: data.skipped || data.error || 'Nothing was sent.' });
      await load();
    } catch (e) { setNote({ ok: false, text: errOf(e) }); }
    setBusy(false);
  }

  if (err && !d) return <div className="jp-err" role="alert">{err} <button type="button" className="btn btn-sm" onClick={load}>Try again</button></div>;
  if (!d) return <div className="nsm-hint">Loading…</div>;
  const wa = d.whatsapp || {};
  const portalOn = wa.portal && wa.portal.configured;

  return (
    <div className="nsm-wrap">
      <p className="nsm-hint" style={{ margin: 0 }}>These are the same accounts as in Integrations. You do not enter them again for the Job Portal: it uses them by itself.</p>

      <section className="nsm-card">
        <div className="nsm-card-hd"><b>WhatsApp</b></div>
        {wa.sendsFrom
          ? <div className={portalOn ? 'jp-ok' : 'jp-err'} style={{ margin: 0 }} role="status">
            {portalOn ? `The Job Portal sends WhatsApp from ${wa.sendsFrom.number || 'your WhatsApp number'} (ID ${wa.sendsFrom.phoneNumberId || ''}).` : 'The Job Portal does not have the WhatsApp number yet.'}
          </div>
          : <div className="jp-err" style={{ margin: 0 }} role="alert">TeamLink has no working WhatsApp number{wa.problem ? `: ${wa.problem}` : ''}. Connect one in Integrations, then it reaches the Job Portal by itself.</div>}
        {wa.portal && wa.portal.error && <div className="jp-err" role="alert">The Job Portal could not be reached: {wa.portal.error}</div>}
        {(wa.numbers || []).length > 0 && (
          <ul className="nsm-hint" style={{ margin: 0, paddingLeft: 18 }}>
            {wa.numbers.map((n) => <li key={`${n.label}-${n.number}`}>{n.label}{n.number ? ` (${n.number})` : ''}{n.isDefault ? ' · the one the Job Portal uses' : ''}{n.active ? '' : ' · switched off'}</li>)}
          </ul>
        )}
        <div className="jp-row">
          <button type="button" className="btn btn-sm" disabled={busy || !wa.sendsFrom} onClick={sync}>{busy ? 'Sending…' : 'Send the number to the Job Portal now'}</button>
          <Link to="/admin/integrations?tab=messaging" className="btn btn-sm">Change the WhatsApp numbers</Link>
        </div>
        <span className="nsm-hint">It is sent again by itself every time the number changes or the Job Portal starts.{wa.lastPush && wa.lastPush.at ? ` Last time: ${when(wa.lastPush.at)}.` : ''}</span>
        {note && <div className={note.ok ? 'jp-ok' : 'jp-err'} role={note.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{note.text}</div>}
      </section>

      <section className="nsm-card">
        <div className="nsm-card-hd"><b>Social media</b></div>
        <span className="nsm-hint">A job of the Job Portal is published to these accounts from the Post step. Tick them there.</span>
        {(d.social || []).map((p) => (
          <div key={p.platform} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <b style={{ minWidth: 86 }}>{NAME[p.platform] || p.platform}</b>
            {p.accounts.length === 0
              ? <span className="nsm-hint">Not connected</span>
              : p.accounts.map((a) => <span key={`${a.name}-${a.username || ''}`} className={tone(a.status)} style={{ margin: 0, padding: '2px 8px' }}>{a.name}{a.username ? ` @${a.username}` : ''}{a.isDefault ? ' · default' : ''} · {a.status}</span>)}
          </div>
        ))}
        <div className="jp-row"><Link to="/admin/integrations?tab=facebook" className="btn btn-sm">Add or change social media accounts</Link></div>
      </section>

      <section className="nsm-card">
        <div className="nsm-card-hd"><b>AI calling</b></div>
        {d.aiCalling
          ? <div className={d.aiCalling.state === 'Connected' ? 'jp-ok' : 'jp-err'} style={{ margin: 0 }} role="status">{d.aiCalling.state}{d.aiCalling.detail ? `: ${d.aiCalling.detail}` : ''}</div>
          : <span className="nsm-hint">The status could not be read.</span>}
        <span className="nsm-hint">The Job Portal&apos;s recruiters make AI calls through TeamLink&apos;s AI calling. There is nothing to set up in the Job Portal.</span>
        <div className="jp-row"><Link to="/admin/integrations?tab=aicalling" className="btn btn-sm">Open AI calling</Link></div>
      </section>
    </div>
  );
}
