#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE SALES CRM (founder 2026-11-02): leads, duplicate check, convert, deals pipeline, follow-ups, dashboard, who sees what.
// SANDBOX ONLY.
//
//   cd backend && TL_API=http://localhost:4011 node scripts/crm-sales-test.js
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('CRMS');

const { prisma, check, RUN } = Z;
const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const PHONE = `98${String(Date.now()).slice(-8)}`;

(async () => {
  await Z.preclean();
  try {
    const bde1 = await Z.mkUser('bde1', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const bde2 = await Z.mkUser('bde2', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const tl = await Z.mkUser('tl', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const mgr = await Z.mkUser('mgr', { role: 'EMPLOYEE', atsRole: 'MANAGER', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const rec = await Z.mkUser('rec', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'IT', atsScopeDepartments: 'IT' });
    const tk = { b1: await Z.mint(bde1), b2: await Z.mint(bde2), tl: await Z.mint(tl), mgr: await Z.mint(mgr), rec: await Z.mint(rec) };

    const no = await Z.call('GET', '/api/crm/me', tk.rec);
    check('1 a recruiter cannot open the CRM', no.status === 403, no.status);
    const me = await Z.call('GET', '/api/crm/me', tk.b1);
    const meTl = await Z.call('GET', '/api/crm/me', tk.tl);
    const meM = await Z.call('GET', '/api/crm/me', tk.mgr);
    check('2 roles: BDE edits own, BDE TL assigns, Manager reads only', me.body.role === 'bde' && me.body.canEdit && !me.body.canAssign && meTl.body.role === 'tl' && meTl.body.canAssign && meM.body.role === 'view' && !meM.body.canEdit, [me.body.role, meTl.body.role, meM.body.role]);

    const L = await Z.call('POST', '/api/crm/leads', tk.b1, { company: `ZZTEST CRMS Acme Pvt Ltd ${RUN}`, contactName: 'Ravi Kumar', designation: 'HR Head', phone: PHONE, email: `zz-crms-${RUN}@example.test`, city: 'Hyderabad', industry: 'IT', source: 'LinkedIn' });
    const lead = L.body && L.body.lead;
    check('3 the BDE adds a lead (it is theirs, status New)', L.status === 200 && lead && lead.ownerId === bde1.id && lead.status === 'New', [L.status, L.body]);

    const dup = await Z.call('POST', '/api/crm/leads', tk.b2, { company: 'ZZTEST CRMS someone else', phone: `+91 ${PHONE}` });
    check('4 the same phone from another BDE: "already in TeamLink" with who has it', dup.status === 409 && dup.body.duplicates.some((d) => d.id === lead.id && d.owner === bde1.name), [dup.status, dup.body]);

    const l2 = await Z.call('GET', '/api/crm/leads', tk.b2);
    const one2 = await Z.call('GET', `/api/crm/leads/${lead.id}`, tk.b2);
    check('5 another BDE neither lists nor opens it', l2.status === 200 && !l2.body.rows.some((x) => x.id === lead.id) && one2.status === 404, [l2.status, one2.status]);
    const lt = await Z.call('GET', '/api/crm/leads', tk.tl);
    const lm = await Z.call('GET', '/api/crm/leads', tk.mgr);
    const addM = await Z.call('POST', '/api/crm/leads', tk.mgr, { company: `ZZTEST CRMS mgr ${RUN}` });
    check('6 the BDE TL and the Manager see it; the Manager cannot add', lt.body.rows.some((x) => x.id === lead.id) && lm.body.rows.some((x) => x.id === lead.id) && addM.status === 403, [addM.status]);

    const act = await Z.call('POST', '/api/crm/activities', tk.b1, { kind: 'call', subject: 'First call', note: 'Hiring 5 Java developers', leadId: lead.id, followUp: { title: 'Send the proposal', dueDate: today, dueTime: '11:00' } });
    const leadAfter = await Z.call('GET', `/api/crm/leads/${lead.id}`, tk.b1);
    check('7 a call is logged with a follow-up; the lead is Contacted now', act.status === 200 && act.body.task && leadAfter.body.lead.status === 'Contacted' && leadAfter.body.activities.length === 1 && leadAfter.body.tasks.length === 1, [act.status, act.body, leadAfter.body && leadAfter.body.lead && leadAfter.body.lead.status]);

    const tdy = await Z.call('GET', '/api/crm/tasks?when=today', tk.b1);
    const bell = await prisma.notification.findFirst({ where: { userId: bde1.id, title: { contains: 'CRM follow-up today' } } });
    check('8 the follow-up is in Today, and the BDE got a bell notice', tdy.body.tasks.some((t) => t.id === act.body.task.id && t.recordName === lead.company) && !!bell, [tdy.body, !!bell]);

    const cv = await Z.call('POST', `/api/crm/leads/${lead.id}/convert`, tk.b1, { openings: 5, avgCtc: 600000, feePercent: 8.33, expectedClose: today });
    const deal = cv.body && cv.body.deal;
    check('9 convert: account + contact + deal (value = 5 x 6,00,000 x 8.33% = 2,49,900)', cv.status === 200 && cv.body.account && cv.body.contact && deal && deal.value === 249900 && deal.stage === 'Contacted', [cv.status, cv.body]);
    const acc = await Z.call('GET', `/api/crm/accounts/${cv.body.account.id}`, tk.b1);
    check('10 the account shows the contact, the deal and the lead\'s timeline', acc.status === 200 && acc.body.contacts.length === 1 && acc.body.deals.length === 1 && acc.body.activities.some((a) => a.subject === 'First call') && acc.body.tasks.length === 1, [acc.status, acc.body && [acc.body.contacts.length, acc.body.deals.length, acc.body.activities.length]]);

    const lostNo = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b1, { stage: 'Lost' });
    const neg = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b1, { stage: 'Negotiation' });
    const other = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b2, { stage: 'Won' });
    check('11 Lost needs a reason; Negotiation = 80%; another BDE cannot move it', lostNo.status === 400 && neg.body.deal.probability === 80 && other.status === 404, [lostNo.status, neg.body, other.status]);
    const won = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b1, { stage: 'Won' });
    const dash = await Z.call('GET', '/api/crm/dashboard', tk.b1);
    check('12 Won: the dashboard counts it this month, the pipeline no longer holds it', won.body.deal.wonAt && dash.body.month.won === 1 && dash.body.month.wonValue === 249900 && dash.body.pipeline.open === 0 && dash.body.leads.converted === 1, [won.body && won.body.deal && won.body.deal.stage, dash.body && dash.body.month, dash.body && dash.body.pipeline]);

    const c = await prisma.client.create({ data: { name: `ZZTEST CRMS Client ${RUN}`, industry: 'IT', location: 'Hyderabad', bdeOwner: bde1.name, clientType: 'Client' } });
    Z.made.clients.push(c.id);
    const lk = await Z.call('POST', `/api/crm/deals/${deal.id}/client`, tk.b1, { clientId: c.id });
    const acc2 = await Z.call('GET', `/api/crm/accounts/${cv.body.account.id}`, tk.b1);
    check('13 "Add as client" links the deal: the account is a Client of TeamLink now', lk.status === 200 && acc2.body.account.kind === 'Client' && acc2.body.client && acc2.body.client.id === c.id, [lk.status, acc2.body && acc2.body.account && acc2.body.account.kind]);

    const L2 = await Z.call('POST', '/api/crm/leads', tk.b1, { company: `ZZTEST CRMS Second ${RUN}`, source: 'Cold call' });
    const delB = await Z.call('DELETE', `/api/crm/lead/${L2.body.lead.id}`, tk.b1);
    const give = await Z.call('PUT', `/api/crm/leads/${L2.body.lead.id}`, tk.tl, { ownerId: bde2.id });
    const seen2 = await Z.call('GET', `/api/crm/leads/${L2.body.lead.id}`, tk.b2);
    const giveB = await Z.call('PUT', `/api/crm/leads/${L2.body.lead.id}`, tk.b2, { ownerId: bde1.id });
    check('14 a BDE cannot delete a lead (Junk instead); the BDE TL gives it to another BDE, who cannot give it on', delB.status === 403 && give.status === 200 && seen2.status === 200 && giveB.status === 403, [delB.status, give.status, seen2.status, giveB.status]);
    const delT = await Z.call('DELETE', `/api/crm/lead/${L2.body.lead.id}`, tk.tl);
    check('15 the BDE TL can delete it', delT.status === 200, delT.status);
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  try {
    const ids = Z.made.users;
    const q = (sql, ...p) => prisma.$executeRawUnsafe(sql, ...p).catch(() => 0);
    const marks = ids.map(() => '?').join(', ');
    if (ids.length) {
      for (const t of ['CrmLead', 'CrmAccount', 'CrmContact', 'CrmDeal', 'CrmTask']) await q(`DELETE FROM "${t}" WHERE "ownerId" IN (${marks}) OR "createdById" IN (${marks})`, ...ids, ...ids); // eslint-disable-line no-await-in-loop
      await q(`DELETE FROM "CrmActivity" WHERE "byId" IN (${marks})`, ...ids);
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    }
    console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  } catch (e) { console.log('cleanup problem', e.message); }
  await Z.finish();
})();
