// CRM > FOLLOW-UPS (founder 2026-11-06): Today, Overdue, Upcoming and Completed, with a date range and an owner filter. Done asks what happened and offers the next follow-up;
// each row shows its type, time and how it reminds. Follow-ups are added from a lead, a deal or an account (crmShared.jsx TaskList); the reminders are crm/sales.js runDue().
import { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../../components/Modal.jsx';
import { useCrm, errOf, dateOf, istToday, RecLink } from './crmShared.jsx';

const TABS = [['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['done', 'Completed']];
export const REMIND_WORDS = { 0: 'At the time', 15: '15 minutes before', 60: '1 hour before', 1440: '1 day before' };

// "Done": what happened, and optionally the next follow-up (used here and in TaskList)
export function DoneDialog({ task, onClose, onDone }) {
  const { toast } = useCrm();
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [nextTitle, setNextTitle] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post(`/crm/tasks/${task.id}/done`, { note });
      if (next) {
        const link = task.dealId ? { dealId: task.dealId } : (task.leadId ? { leadId: task.leadId } : { accountId: task.accountId });
        await api.post('/crm/tasks', { title: nextTitle || task.title, dueDate: next, type: task.type, ...link });
      }
      toast(next ? 'Done. The next follow-up is set.' : 'Done.');
      onDone();
    } catch (e) { toast(errOf(e, 'This could not be saved.')); setBusy(false); }
  }
  return (
    <Modal title={`Done: ${task.title}`} onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="field"><label>What happened?</label><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Spoke to them: wants the proposal by Friday" /></div>
      <div className="grid-2">
        <div className="field"><label>Next follow-up (optional)</label><input type="date" min={istToday()} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="field"><label>What to do then</label><input type="text" value={nextTitle} disabled={!next} onChange={(e) => setNextTitle(e.target.value)} placeholder={task.title} /></div>
      </div>
    </Modal>
  );
}

export default function CrmFollowups() {
  const { me, toast, version } = useCrm();
  const [tab, setTab] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [owner, setOwner] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [doing, setDoing] = useState(null);
  const load = () => api.get('/crm/tasks', { params: { when: tab, all: 1, from: from || undefined, to: to || undefined, owner: owner || undefined } })
    .then((r) => { setRows(r.data.tasks); setErr(''); }).catch((e) => setErr(errOf(e, 'The follow-ups could not be read.')));
  useEffect(() => { setRows(null); load(); }, [tab, from, to, owner, version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cancel(t) {
    try { await api.post(`/crm/tasks/${t.id}/cancel`); toast('Cancelled.'); load(); } catch (e) { toast(errOf(e, 'This could not be cancelled.')); }
  }
  const today = istToday();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Follow-ups</h1><div className="page-sub">Calls, meetings and messages due, with their reminders. Add one from a lead, a deal or an account.</div></div></div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <div key={k} role="tab" tabIndex={0} aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)} onKeyDown={(e) => { if (e.key === 'Enter') setTab(k); }}>{l}</div>)}
      </div>
      <div className="filter-row">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 150 }} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 150 }} />
        {me.seesAll && <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Everyone</option>{me.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
      </div>
      {err && <div className="notice" role="alert">{err}</div>}
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Due</th><th>Type</th><th>Follow-up</th><th>For</th>{me.seesAll && <th>Owner</th>}<th>Reminder</th><th>{tab === 'done' ? 'What happened' : ''}</th></tr></thead>
          <tbody>
            {rows == null && !err && <tr><td colSpan={7} className="small-muted">Loading…</td></tr>}
            {rows && !rows.length && <tr><td colSpan={7}><div className="empty"><h3>Nothing here</h3>No follow-ups in this view.</div></td></tr>}
            {(rows || []).map((t) => (
              <tr key={t.id}>
                <td style={{ color: t.status === 'Open' && t.dueDate < today ? 'var(--red)' : undefined, fontWeight: t.status === 'Open' && t.dueDate <= today ? 600 : undefined, whiteSpace: 'nowrap' }}>{t.dueDate === today ? 'Today' : dateOf(t.dueDate)}{t.dueTime ? ` · ${t.dueTime}` : ''}</td>
                <td>{t.type || 'Call'}</td>
                <td>{t.title}</td>
                <td>{t.recordName ? <RecLink kind={t.recordKind} id={t.recordId}>{t.recordName}</RecLink> : '—'}</td>
                {me.seesAll && <td>{t.ownerName || '—'}</td>}
                <td className="small-muted" style={{ fontSize: 12 }}>
                  {t.notifyApp == null ? 'Daily list' : [REMIND_WORDS[t.remindBefore] || 'At the time', t.notifyWhatsapp ? 'WhatsApp' : '', t.notifySms ? 'SMS' : ''].filter(Boolean).join(' · ')}
                  {t.reminderSentAt ? <div>Sent</div> : null}
                  {t.reminderNote ? <div>{t.reminderNote}</div> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {tab === 'done' ? <span className="small-muted">{t.doneNote || '—'}</span> : (me.canEdit && (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setDoing(t)}>Done</button>
                      <button type="button" className="btn btn-sm" onClick={() => cancel(t)}>Cancel</button>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {doing && <DoneDialog task={doing} onClose={() => setDoing(null)} onDone={() => { setDoing(null); load(); }} />}
    </div>
  );
}
