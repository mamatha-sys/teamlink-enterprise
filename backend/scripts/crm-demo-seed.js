#!/usr/bin/env node
// CRM look-and-feel data for the SANDBOX only (a throwaway copy): one BDE TL login and a few leads / deals / follow-ups.
//   cd backend && TL_API=http://localhost:4011 node scripts/crm-demo-seed.js   -> prints a sandbox token for the browser
const Z = require('./lib/zzfix')('CRMDEMO');

(async () => {
  const day = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
  const tl = await Z.mkUser('tl', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
  const tk = await Z.mint(tl);
  const post = async (p, b) => { const r = await Z.call('POST', p, tk, b); if (r.status !== 200) console.log(p, r.status, r.body); return r.body; };
  const leads = [
    ['Sunrise Hospitals', 'Dr. Meena Rao', 'HR Head', 'Referral', 'Medical'], ['Vertex Steel Pvt Ltd', 'Anil Kumar', 'Plant HR', 'Cold call', 'Manufacturing'],
    ['BrightPath School', 'Sujatha', 'Principal', 'Website', 'Education'], ['NovaSoft Technologies', 'Rahul Jain', 'Talent Lead', 'LinkedIn', 'IT'],
    ['Green Agro Foods', 'Prakash', 'GM', 'Job post signal', 'FMCG'],
  ];
  const made = [];
  for (const [i, [company, contactName, designation, source, industry]] of leads.entries()) {
    const r = await post('/api/crm/leads', { company, contactName, designation, source, industry, city: 'Hyderabad', phone: `90000${String(10000 + i * 7919 + (Date.now() % 9999)).slice(-5)}`, force: true }); // eslint-disable-line no-await-in-loop
    made.push(r.lead);
  }
  await post('/api/crm/activities', { kind: 'call', subject: 'Intro call', note: 'Needs 12 staff nurses in 2 months', leadId: made[0].id, followUp: { dueDate: day(0), title: 'Send our fee proposal' } });
  await post('/api/crm/activities', { kind: 'whatsapp', subject: 'Shared company profile', leadId: made[1].id, followUp: { dueDate: day(-2), title: 'Call back on the welder hiring' } });
  const c1 = await post(`/api/crm/leads/${made[0].id}/convert`, { openings: 12, avgCtc: 360000, feePercent: 8.33, expectedClose: day(12) });
  const c2 = await post(`/api/crm/leads/${made[3].id}/convert`, { openings: 5, avgCtc: 1200000, feePercent: 8.33, expectedClose: day(25) });
  await post(`/api/crm/deals/${c1.deal.id}/stage`, { stage: 'Proposal sent' });
  await post(`/api/crm/deals/${c2.deal.id}/stage`, { stage: 'Meeting' });
  await post('/api/crm/tasks', { title: 'Meeting with the CTO', dueDate: day(2), dealId: c2.deal.id });
  const c3 = await post(`/api/crm/leads/${made[4].id}/convert`, { openings: 3, avgCtc: 500000, feePercent: 10 });
  await post(`/api/crm/deals/${c3.deal.id}/stage`, { stage: 'Won' });
  console.log(`TOKEN ${tk}`);
  await Z.prisma.$disconnect();
})();
