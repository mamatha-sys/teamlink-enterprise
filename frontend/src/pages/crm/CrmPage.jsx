// ---------------------------------------------------------------------------
// THE CRM MODULE (founder 2026-11-02: "side bar lo crm ani oka module raavali" - a TeamLink module of its own, like HRMS / ATS,
// with the eight pages of the Omni-Channel CRM): CRM Forms, Data Tables, Customer Tables, CRM Fields, WhatsApp Bot Data,
// Shopify, Meta catalogs, WhatsApp Flow Responses. Each page is built one by one; until then it says plainly what it will do
// (no made-up data). The list of pages lives in nav.js (CRM_ITEMS) and here (PAGES), keyed by the address.
// ---------------------------------------------------------------------------
import { useParams, Link } from 'react-router-dom';
import CrmForms from './CrmForms.jsx';

export const CRM_PAGES = {
  forms: { icon: '🗒️', title: 'CRM Forms', what: 'Forms that collect leads and details from clients and candidates - on your website, in a link, or in WhatsApp - and save every answer straight into the CRM.' },
  'data-tables': { icon: '🗄️', title: 'Data Tables', what: 'Your own tables (for example Branches, Services, Job openings): you choose the columns, add rows or import a sheet, and forms, bots and messages can use the data.' },
  'customer-tables': { icon: '📋', title: 'Customer Tables', what: 'All your contacts as a spreadsheet: pick the columns (CRM fields), filter, edit right in the table and export.' },
  fields: { icon: '🏷️', title: 'CRM Fields', what: 'The fields every contact carries (name, company, city, source, your own custom fields), in one place, used by forms, tables and messages.' },
  'bot-data': { icon: '💬', title: 'WhatsApp Bot Data', what: 'What people answered in your WhatsApp bot conversations, kept per contact and searchable.' },
  shopify: { icon: '🛒', title: 'Shopify', what: 'Connect a Shopify store: customers and orders come into the CRM, so you can follow up on WhatsApp.' },
  'meta-catalogs': { icon: '🧩', title: 'Meta catalogs', what: 'Your Meta (Facebook / WhatsApp) product catalogs: see the items, keep them in sync and send them in WhatsApp chats.' },
  'flow-responses': { icon: '📨', title: 'WhatsApp Flow Responses', what: 'Every answer people send through your WhatsApp Flows (in-chat forms), in one list you can search, filter and export.' },
};

export default function CrmPage() {
  const { page } = useParams();
  if (page === 'forms') return <CrmForms />; // built (2026-11-02): the Omni-Channel Web Forms, inside the CRM module
  const p = CRM_PAGES[page];
  if (!p) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>CRM</h1><div className="page-sub">This page does not exist.</div></div></div>
        <Link className="btn" to="/crm/forms">Open CRM Forms</Link>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{p.title}</h1>
          <div className="page-sub">CRM</div>
        </div>
      </div>
      <div className="card section" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 34 }} aria-hidden="true">{p.icon}</div>
        <h3 style={{ margin: '10px 0 6px' }}>{p.title} is being built</h3>
        <p className="small-muted" style={{ maxWidth: 560, margin: '0 auto' }}>{p.what}</p>
        <p className="small-muted" style={{ marginTop: 14 }}>Nothing is shown here yet, so there is no data to read on this page.</p>
      </div>
    </div>
  );
}
