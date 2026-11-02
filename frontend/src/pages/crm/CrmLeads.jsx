// CRM > LEADS (2026-11-02): every lead (company, contact, source, status, owner, last touched, next follow-up), search and
// filters; + Lead (duplicate check against leads, accounts, contacts and TeamLink clients); a row opens the lead with its
// timeline, follow-ups and "Convert to deal".
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useCrm, errOf, dateOf, istToday, Pill, RecordForm, RecordPanel, useOpenParam } from './crmShared.jsx';

export default function CrmLeads() {
  const { me } = useCrm();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useOpenParam(sp, setSp);
  const [adding, setAdding] = useState(sp.get('add') === '1');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const load = () => api.get('/crm/leads', { params: { q: q || undefined, status: status || undefined, source: source || undefined, owner: owner || undefined } })
    .then((r) => { setRows(r.data.rows); setErr(''); }).catch((e) => setErr(errOf(e, 'The leads could not be read.')));
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [q, status, source, owner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sp.get('add') === '1') { const n = new URLSearchParams(sp); n.delete('add'); setSp(n, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const today = istToday();

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Leads</h1><div className="page-sub">Companies to sell to, before they become a deal</div></div>
        {me.canEdit && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Lead</button>}
      </div>
      <div className="filter-row">
        <input type="text" placeholder="Search company, person, phone, email, city" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} aria-label="Search leads" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Open leads</option>
          {me.lists.leadStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="all">All leads</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Any source</option>{me.lists.sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        {me.seesAll && <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Every BDE</option>{me.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
      </div>
      {err && <div className="notice" role="alert">{err}</div>}
      {rows && <div className="results-bar"><span>{rows.length} lead{rows.length === 1 ? '' : 's'}</span></div>}
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Company</th><th>Contact</th><th>Source</th><th>Status</th><th>Last touched</th><th>Next follow-up</th>{me.seesAll && <th>Owner</th>}</tr></thead>
          <tbody>
            {rows == null && <tr><td colSpan={7} className="small-muted">Loading…</td></tr>}
            {rows && !rows.length && <tr><td colSpan={7}><div className="empty"><h3>No leads here</h3>{me.canEdit ? 'Add your first lead with "+ Lead".' : 'Nothing matches.'}</div></td></tr>}
            {(rows || []).map((l) => (
              <tr key={l.id} className="row-link" onClick={() => setOpen({ kind: 'lead', id: l.id })}>
                <td><b>{l.company}</b><div className="small-muted" style={{ fontSize: 11.5 }}>{[l.industry, l.city].filter(Boolean).join(' · ')}</div></td>
                <td>{l.contactName || '—'}<div className="small-muted" style={{ fontSize: 11.5 }}>{[l.designation, l.phone].filter(Boolean).join(' · ')}</div></td>
                <td>{l.source || '—'}</td>
                <td><Pill v={l.status} /></td>
                <td className="small-muted">{l.lastActivityAt ? dateOf(l.lastActivityAt) : 'Never'}</td>
                <td style={{ color: l.nextTaskDue && l.nextTaskDue < today ? 'var(--red)' : undefined, fontWeight: l.nextTaskDue && l.nextTaskDue <= today ? 600 : undefined }}>{l.nextTaskDue ? (l.nextTaskDue === today ? 'Today' : dateOf(l.nextTaskDue)) : '—'}</td>
                {me.seesAll && <td>{l.ownerName || '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <RecordForm kind="lead" preset={{ source: '' }} onClose={() => setAdding(false)} onSaved={(row) => { setAdding(false); load(); setOpen({ kind: 'lead', id: row.id }); }} />}
      {open && <RecordPanel kind={open.kind} id={open.id} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}
