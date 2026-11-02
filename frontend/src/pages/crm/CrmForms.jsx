// ---------------------------------------------------------------------------
// CRM > CRM FORMS (founder 2026-11-02, the first CRM page to build). The forms are the Omni-Channel Web Forms that already
// work - create / edit a form, its public link and embed code, the people who filled it (saved as customers, with their
// permission per way of contact) - shown here inside the CRM module. Same data, same API (/api/outreach/gs/crm/forms), same
// rules (Admin, BDE, BDE TL ...: routes/outreach.js). The page runs inside the Omni-Channel look (gs.css) with its context:
// the account (/outreach/me + /outreach/access), a small toast, and "go" that opens the other Omni-Channel pages (Customers).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { OmniCtx } from '../../components/omni/omniContext.js';
import { pagePath } from '../../components/omni/omniPages.js';
import FormsPage from '../../components/omni/pages/FormsPage.jsx';
import '../../components/omni/gs.css';

export default function CrmForms() {
  const navigate = useNavigate();
  const [acc, setAcc] = useState(null);
  const [err, setErr] = useState('');
  const [toastText, setToastText] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    let on = true;
    api.get('/outreach/me').then(async (me) => {
      let old = {};
      try { old = (await api.get('/outreach/access')).data; } catch { old = {}; }
      if (on) setAcc({ ...old, ...me.data });
    }).catch((e) => { if (on) setErr((e.response && e.response.data && e.response.data.error) || 'CRM Forms could not be opened.'); });
    return () => { on = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  const toast = useCallback((text) => {
    setToastText(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastText(''), 3200);
  }, []);
  // "View" / "Open CRM" in the forms page open the people in Omni-Channel > Customers (Customer Tables comes later in CRM)
  const go = useCallback((id, params) => {
    const q = params ? `?${new URLSearchParams(params).toString()}` : '';
    navigate(`${pagePath(id)}${q}`);
  }, [navigate]);
  const ctx = useMemo(() => ({ acc, go, toast, dept: '' }), [acc, go, toast]);

  if (err) return <div className="gsx"><div className="content"><div className="card panel" role="alert" style={{ color: '#9b1c1c' }}>{err}</div></div></div>;
  if (!acc) return <div className="gsx"><div className="content"><div className="card panel">Loading…</div></div></div>;
  return (
    <OmniCtx.Provider value={ctx}>
      <div className="gsx" data-page="forms">
        <div className="content">
          <FormsPage title="CRM Forms" />
        </div>
        <div className={`toast${toastText ? ' show' : ''}`} role="status" aria-live="polite">{toastText}</div>
      </div>
    </OmniCtx.Provider>
  );
}
