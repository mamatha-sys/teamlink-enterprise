// "Delete completely" for a test person (backend utils/testPersonDelete.js) - Super Admin only, on Administration -> Users and the
// candidate's page. Shows what goes and what stays first; deleting needs the employee code (or the name) typed.
import { useState } from 'react';
import api from '../api';
import Modal from './Modal.jsx';

export const mayDeleteCompletely = (me) => !!me && me.role === 'SUPER_ADMIN' && !me.hrSuper;

export default function FullDeleteButton({ userId, candidateId, name, onDone, className = 'btn btn-sm btn-danger' }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const target = userId ? { userId } : { candidateId };

  async function start() {
    setOpen(true); setPlan(null); setError(''); setTyped('');
    try { setPlan((await api.get('/admin/full-delete/preview', { params: target })).data); } catch (e) { setError(e.response?.data?.error || 'Could not check this person.'); }
  }
  async function confirm() {
    setBusy(true); setError('');
    try {
      const r = await api.post('/admin/full-delete', { ...target, confirm: typed });
      setOpen(false);
      onDone?.(r.data.message);
    } catch (e) { setError(e.response?.data?.error || 'Nothing was deleted.'); } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" className={className} onClick={start} title="Delete a test or wrong person from HRMS and ATS completely. Shows what goes first.">Delete</button>
      {open && (
        <Modal
          title={`Delete ${plan ? plan.name : name || 'this person'} completely`}
          onClose={() => setOpen(false)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              {plan && <button type="button" className="btn btn-danger" disabled={busy || !typed.trim()} onClick={confirm}>{busy ? 'Deleting…' : 'Delete completely'}</button>}
            </>
          )}
        >
          {!plan && !error && <p className="small-muted">Checking what is linked…</p>}
          {error && <p className="error-text" role="alert">{error}</p>}
          {plan && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p>This removes the person from HRMS and ATS for good. Only what is listed here goes.</p>
              {plan.logins.length > 0 && <div><b>Login:</b> {plan.logins.map((l) => `${l.name} (${l.email})`).join(', ')}</div>}
              {plan.employees.length > 0 && <div><b>Employee:</b> {plan.employees.map((e) => `${e.name}${e.code ? ` · ${e.code}` : ''}`).join(', ')}</div>}
              {plan.candidates.length > 0 && <div><b>Candidate:</b> {plan.candidates.map((c) => c.name).join(', ')}</div>}
              {plan.applications > 0 && <div><b>Applications (jobs, joinings):</b> {plan.applications}</div>}
              <div className="small-muted">{plan.rows.map((r) => `${r.label}: ${r.count}`).join(' · ')}</div>
              {plan.kept.length > 0 && (
                <div className="notice">
                  <b>Stays:</b>
                  <ul style={{ margin: '4px 0 0 18px' }}>{plan.kept.map((k) => <li key={k}>{k}</li>)}</ul>
                </div>
              )}
              <div className="small-muted">A copy of every removed row is kept on the server, so it can be brought back by hand if this was a mistake.</div>
              <label className="field">
                <span>{`Type ${plan.confirmWord} to confirm`}</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Confirmation" />
              </label>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
