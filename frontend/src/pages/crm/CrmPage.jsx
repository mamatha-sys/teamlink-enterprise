// ---------------------------------------------------------------------------
// THE CRM MODULE - a real sales CRM (founder 2026-11-02: "oka sales dhani kosam, crm lo em em vundalo ... take the actual
// official crm"; then "3 to 4 modules chaalu ... ahh 3 to 4 modules lo ney, motham crm cover ayyeylaaga chudu").
// Four screens cover the whole CRM; activities (calls, meetings, emails, WhatsApp, notes) and follow-ups live inside every
// record and on the Dashboard:
//   /crm/dashboard   pipeline, won / lost this month, follow-ups due today and late, lead sources, closing soon
//   /crm/leads       leads with the duplicate check; Convert -> account + contact + deal
//   /crm/deals       the pipeline board (drag a deal to its stage); Won -> Add as client (ATS > Clients)
//   /crm/accounts    Accounts & Contacts: prospects and clients, with their people, deals and timeline
// Who sees what is decided by the server (backend/src/crm/service.js): a BDE their own, the BDE TL and Admins everything,
// a Manager everything read-only.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import api from '../../api';
import { CrmCtx, errOf } from './crmShared.jsx';
import CrmDashboard from './CrmDashboard.jsx';
import CrmLeads from './CrmLeads.jsx';
import CrmDeals from './CrmDeals.jsx';
import CrmAccounts from './CrmAccounts.jsx';
import './crm.css';

const PAGES = { dashboard: CrmDashboard, leads: CrmLeads, deals: CrmDeals, accounts: CrmAccounts };

export default function CrmPage() {
  const { page } = useParams();
  const [me, setMe] = useState(null);
  const [err, setErr] = useState('');
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const reloadMe = useCallback(() => api.get('/crm/me').then((r) => setMe(r.data)).catch((e) => setErr(errOf(e, 'The CRM could not be opened.'))), []);
  useEffect(() => { reloadMe(); }, [reloadMe]);
  const toast = useCallback((text) => {
    seq.current += 1; const id = seq.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const ctx = useMemo(() => ({ me, toast, reloadMe }), [me, toast, reloadMe]);

  const Page = PAGES[page];
  if (!Page) return <Navigate to="/crm/dashboard" replace />; // the old CRM addresses (forms, data tables ...) land on the dashboard
  if (err) return <div className="page"><div className="page-head"><div><h1>CRM</h1></div></div><div className="notice" role="alert">{err}</div></div>;
  if (!me) return <div className="page"><div className="small-muted">Loading the CRM…</div></div>;
  return (
    <CrmCtx.Provider value={ctx}>
      <Page />
      <div className="toast-stack" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </CrmCtx.Provider>
  );
}
