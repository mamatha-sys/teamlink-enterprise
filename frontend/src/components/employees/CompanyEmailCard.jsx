import { useEffect, useState } from 'react';
import api from '../../api';

// ---------------------------------------------------------------------------
// LOGIN & COMPANY EMAIL on the employee page (founder 2026-11-06), for HR / Admin. The personal email stays for documents and password recovery; the company email
// becomes the login. Saving moves the login, signs the person out, and tells them on their personal email (utils/companyEmail.js). With cPanel connected on the server,
// "Create mailbox" also makes the mailbox. Data: GET / POST /employees/:id/company-email.
// ---------------------------------------------------------------------------
export default function CompanyEmailCard({ employeeId, onChanged }) {
  const [s, setS] = useState(null);
  const [email, setEmail] = useState('');
  const [personal, setPersonal] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [secret, setSecret] = useState('');

  function load() {
    return api.get(`/employees/${employeeId}/company-email`).then((r) => {
      setS(r.data);
      setEmail(r.data.companyEmail || r.data.suggestion || '');
      setPersonal(r.data.personalEmail || '');
    }).catch(() => setS(null));
  }
  useEffect(() => { load(); }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;

  async function save(createMailbox) {
    setBusy(true); setError(''); setMsg(''); setSecret('');
    try {
      const r = await api.post(`/employees/${employeeId}/company-email`, { email, personalEmail: personal, createMailbox });
      setMsg(r.data.message || 'Saved.');
      setSecret(r.data.mailboxPassword || '');
      setEditing(false);
      await load();
      if (onChanged) await onChanged();
    } catch (e) {
      setError(e.response?.data?.error || 'That did not save. Please try again.');
    } finally { setBusy(false); }
  }

  const showForm = !s.companyEmail || editing;
  const noPersonal = !s.personalEmail;
  return (
    <>
      <h3 style={{ fontSize: 13, margin: '14px 0 8px' }}>Login &amp; company email</h3>
      <div className="kv"><span className="k">Personal email</span><span>{s.personalEmail || (s.companyEmail ? '—' : s.workingEmail || '—')}</span></div>
      <div className="kv"><span className="k">Company email</span><span>{s.companyEmail || 'Not given yet'}</span></div>
      <div className="kv"><span className="k">Signs in with</span><span>{s.loginEmail || 'No login yet'}</span></div>
      {s.assignedAt && <div className="kv"><span className="k">Given by</span><span>{`${s.assignedBy || 'HR'} · ${new Date(s.assignedAt).toLocaleString('en-GB')}`}</span></div>}
      {showForm ? (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {noPersonal && s.companyEmail === null && !s.workingEmail && (
            <label className="field"><span>Personal email</span><input type="email" value={personal} onChange={(e) => setPersonal(e.target.value)} placeholder="their own email" /></label>
          )}
          {noPersonal && s.companyEmail && (
            <label className="field"><span>Personal email (for password recovery)</span><input type="email" value={personal} onChange={(e) => setPersonal(e.target.value)} placeholder="their own email" /></label>
          )}
          <label className="field">
            <span>Company email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={s.domains.length ? `name@${s.domains[0]}` : 'name@company.com'} aria-label="Company email" />
          </label>
          <div className="small-muted">
            {s.cpanel.on ? 'Make the mailbox from here, or use one already made in cPanel.' : 'Make the mailbox in cPanel first, then write it here.'}
            {' '}The person is signed out and uses this email from their next sign-in; their password stays the same. They are told on their personal email.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s.cpanel.on && <button type="button" className="btn btn-sm btn-primary" disabled={busy || !email.trim()} onClick={() => save(true)}>{busy ? 'Working…' : 'Create mailbox and assign'}</button>}
            <button type="button" className={`btn btn-sm${s.cpanel.on ? '' : ' btn-primary'}`} disabled={busy || !email.trim()} onClick={() => save(false)}>{busy ? 'Saving…' : 'Assign company email'}</button>
            {editing && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setEditing(false); setEmail(s.companyEmail || ''); setError(''); }}>Cancel</button>}
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setEditing(true)}>Change company email</button>
      )}
      {error && <div className="error-text" style={{ marginTop: 6 }}>{error}</div>}
      {msg && <div className="notice green" style={{ marginTop: 6 }}>{msg}</div>}
      {secret && <div className="notice amber" style={{ marginTop: 6 }}>{`The mail could not carry the mailbox password, so give it to them yourself. It is shown only now: ${secret}`}</div>}
    </>
  );
}
