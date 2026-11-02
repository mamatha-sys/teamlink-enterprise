#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CRM CUSTOMER SUPPORT, CAMPAIGNS AND THE AI ASSISTANT (2026-11-02, from the founder's reference CRM). SANDBOX ONLY.
//
//   cd backend && TL_API=http://localhost:4011 node scripts/crm-extras-test.js
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('CRMX');

const { prisma, check, RUN } = Z;
const day = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

(async () => {
  await Z.preclean();
  try {
    const bde = await Z.mkUser('bde', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const bde2 = await Z.mkUser('bde2', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const tl = await Z.mkUser('tl', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const tk = { b: await Z.mint(bde), b2: await Z.mint(bde2), tl: await Z.mint(tl) };
    const acc = (await Z.call('POST', '/api/crm/accounts', tk.b, { name: `ZZTEST CRMX Hospital ${RUN}`, city: 'Hyderabad', force: true })).body.account;
    const ct = (await Z.call('POST', '/api/crm/contacts', tk.b, { name: 'ZZ Contact', accountId: acc.id, email: `zz-crmx-${RUN}@example.test`, role: 'HR' })).body.contact;

    // ---- customer support
    const t1 = await Z.call('POST', '/api/crm/tickets', tk.b, { subject: 'Candidate left in 10 days - replacement', accountId: acc.id, contactId: ct.id, category: 'Candidate replacement', priority: 'High', channel: 'Phone' });
    const tk1 = t1.body && t1.body.ticket;
    const dueH = tk1 ? (Date.parse(tk1.dueAt) - Date.parse(tk1.createdAt)) / 3600000 : 0;
    check('1 a ticket is opened: number TKT-, High = reply due in 24 h, on the account timeline', t1.status === 200 && /^TKT-\d{4}$/.test(tk1.number) && Math.round(dueH) === 24, [t1.status, t1.body]);
    const see2 = await Z.call('GET', `/api/crm/tickets/${tk1.id}`, tk.b2);
    const seeT = await Z.call('GET', '/api/crm/tickets', tk.tl);
    const accD = await Z.call('GET', `/api/crm/accounts/${acc.id}`, tk.b);
    check('2 another salesperson cannot open it; the sales manager sees it; the account timeline has it', see2.status === 404 && seeT.body.rows.some((x) => x.id === tk1.id) && accD.body.activities.some((a) => /Support ticket TKT-/.test(a.subject)), [see2.status]);
    const urg = await Z.call('PUT', `/api/crm/tickets/${tk1.id}`, tk.b, { priority: 'Urgent' });
    check('3 Urgent = reply due within 4 hours of opening', urg.status === 200 && Math.round((Date.parse(urg.body.ticket.dueAt) - Date.parse(tk1.createdAt)) / 3600000) === 4, urg.body);
    const note = await Z.call('POST', `/api/crm/tickets/${tk1.id}/comments`, tk.b, { body: 'Called the HR, shortlisting two profiles.' });
    const reply = await Z.call('POST', `/api/crm/tickets/${tk1.id}/comments`, tk.b, { body: 'We are sending replacements by Friday.', toCustomer: true });
    const d1 = await Z.call('GET', `/api/crm/tickets/${tk1.id}`, tk.b);
    check('4 an internal note is saved; a reply the mailer refuses (test address) says so and saves nothing', note.status === 200 && reply.status === 502 && /not emailed/i.test(reply.body.error) && d1.body.comments.filter((c) => !c.internal).length === 0 && d1.body.comments.some((c) => /shortlisting/.test(c.body)), [note.status, reply.status, reply.body]);
    const res = await Z.call('PUT', `/api/crm/tickets/${tk1.id}`, tk.b, { status: 'Resolved' });
    const lst = await Z.call('GET', '/api/crm/tickets?status=Resolved', tk.b);
    check('5 Resolved: time stamped, the status change is in the thread, the stats count it', res.body.ticket.resolvedAt && lst.body.rows.some((x) => x.id === tk1.id) && lst.body.stats.resolved30 >= 1, [res.body, lst.body.stats]);
    const give = await Z.call('PUT', `/api/crm/tickets/${tk1.id}`, tk.b, { ownerId: bde2.id });
    check('6 a salesperson cannot hand a ticket to someone else', give.status === 403, give.status);

    // ---- campaigns
    await Z.call('POST', '/api/crm/leads', tk.b, { company: `ZZTEST CRMX A ${RUN}`, contactName: 'Asha Rao', email: `zz-crmx-a-${RUN}@example.test`, source: 'LinkedIn', force: true });
    await Z.call('POST', '/api/crm/leads', tk.b, { company: `ZZTEST CRMX B ${RUN}`, contactName: 'Bala', email: `zz-crmx-b-${RUN}@example.test`, source: 'LinkedIn', force: true });
    await Z.call('POST', '/api/crm/leads', tk.b, { company: `ZZTEST CRMX C ${RUN}`, contactName: 'Chandra', source: 'LinkedIn', force: true });
    const audience = { kind: 'leads', status: 'open', source: 'LinkedIn', owner: bde.id };
    const no = await Z.call('POST', '/api/crm/campaigns', tk.b, { name: 'x', channel: 'email', subject: 's', body: 'b', audience });
    const oo = await Z.call('POST', '/api/crm/opt-out', tk.b, { channel: 'email', value: `zz-crmx-b-${RUN}@example.test` });
    const pv = await Z.call('POST', '/api/crm/campaigns/preview', tk.tl, { channel: 'email', audience });
    check('7 only a sales manager makes campaigns; preview: 3 people, 1 reachable, 1 without email, 1 opted out', no.status === 403 && oo.status === 200 && pv.body.total === 3 && pv.body.reachable === 1 && pv.body.noAddress === 1 && pv.body.optedOut === 1, [no.status, pv.body]);
    const cm = await Z.call('POST', '/api/crm/campaigns', tk.tl, { name: `ZZTEST CRMX Nov ${RUN}`, channel: 'email', subject: 'Hiring help for {company}', body: 'Hi {first_name},\n\nWe help {company} hire faster.\n\n{sender}', audience });
    const camp = cm.body.campaign;
    const sd = await Z.call('POST', `/api/crm/campaigns/${camp.id}/send`, tk.tl);
    let det;
    for (let i = 0; i < 40; i += 1) { await wait(250); det = await Z.call('GET', `/api/crm/campaigns/${camp.id}`, tk.tl); if (det.body.campaign.status !== 'Sending') break; } // eslint-disable-line no-await-in-loop
    const rc = det.body.recipients;
    check('8 send: 3 recipients - 1 tried (the mailer refuses test addresses = failed, with the reason), 2 skipped (no email / opted out); campaign finishes', sd.status === 200 && sd.body.toSend === 1 && det.body.campaign.status === 'Sent' && rc.length === 3 && rc.filter((x) => x.status === 'skipped').length === 2 && rc.some((x) => x.status === 'failed' && x.error) && rc.some((x) => x.error === 'opted out'), [sd.body, det.body.campaign, rc]);
    const again = await Z.call('POST', `/api/crm/campaigns/${camp.id}/send`, tk.tl);
    check('9 a sent campaign cannot be sent twice', again.status === 400, again.status);
    const C = require('../src/crm/campaigns'); // eslint-disable-line global-require
    const okLink = await fetch(`${Z.API}/api/crm-public/unsubscribe?t=${C.tokenFor(`zz-crmx-a-${RUN}@example.test`)}`);
    const badLink = await fetch(`${Z.API}/api/crm-public/unsubscribe?t=${Buffer.from(`zz-crmx-a-${RUN}@example.test`).toString('base64url')}.forged`);
    const pv2 = await Z.call('POST', '/api/crm/campaigns/preview', tk.tl, { channel: 'email', audience });
    check('10 the unsubscribe link (no login) opts the address out; a forged link is refused', okLink.status === 200 && /unsubscribed/i.test(await okLink.text()) && badLink.status === 400 && pv2.body.reachable === 0 && pv2.body.optedOut === 2, [okLink.status, badLink.status, pv2.body]);
    check('11 merge fields fill the name and company', C.merge('Hi {first_name} from {company}', { name: 'Asha Rao', company: 'Acme' }, 'X') === 'Hi Asha from Acme');

    // ---- AI assistant
    const dl = (await Z.call('POST', '/api/crm/deals', tk.b, { title: `ZZTEST CRMX deal ${RUN}`, accountId: acc.id, value: 300000, expectedClose: day(-3) })).body.deal;
    const ins = await Z.call('GET', `/api/crm/ai/insight/deal/${dl.id}`, tk.b);
    check('12 AI insight (rules): a score with reasons, and next actions - close date passed, no follow-up set, no decision maker', ins.status === 200 && typeof ins.body.score === 'number' && ins.body.reasons.length >= 2 && ins.body.actions.some((a) => /close date/i.test(a.text)) && ins.body.actions.some((a) => /follow-up/i.test(a.text)) && ins.body.actions.some((a) => /decision maker/i.test(a.text)), ins.body);
    const ins2 = await Z.call('GET', `/api/crm/ai/insight/deal/${dl.id}`, tk.b2);
    const sum = await Z.call('POST', `/api/crm/ai/summary/deal/${dl.id}`, tk.b);
    check('13 another salesperson gets nothing; the model summary answers plainly when no AI runs (sandbox)', ins2.status === 404 && (sum.status === 200 || (sum.status === 503 && sum.body.error)), [ins2.status, sum.status, sum.body]);

    // ---- sample data (founder: "dummy sale data include cheyyu ... test cheskodaniki")
    const before = await Z.call('GET', '/api/crm/sample', tk.tl);
    const noB = await Z.call('POST', '/api/crm/sample', tk.b);
    if (before.body && before.body.loaded) await Z.call('DELETE', '/api/crm/sample', tk.tl);
    const ld = await Z.call('POST', '/api/crm/sample', tk.tl);
    const twice = await Z.call('POST', '/api/crm/sample', tk.tl);
    const ovS = await Z.call('GET', '/api/crm/overview', tk.tl);
    const bells = await prisma.notification.count({ where: { userId: tl.id, title: { contains: 'CRM follow-up' } } });
    const tix = await Z.call('GET', '/api/crm/tickets?status=all', tk.tl);
    check('14 a salesperson cannot load sample data; the sales manager loads it once: leads, deals in every stage, tickets; the dashboard fills; no reminder bell for sample follow-ups', noB.status === 403 && ld.status === 200 && ld.body.counts.leads === 10 && ld.body.counts.deals === 10 && ld.body.counts.tickets === 3 && twice.status === 400 && ovS.body.cards.revenue.value > 0 && ovS.body.recentDeals.length > 0 && bells === 0 && tix.body.rows.some((t) => /^Sample · /.test(t.subject)), [noB.status, ld.status, ld.body, twice.status, bells]);
    const rm = await Z.call('DELETE', '/api/crm/sample', tk.tl);
    const leftL = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM "CrmLead" WHERE "company" LIKE \'Sample · %\'');
    const leftT = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM "CrmTicket" WHERE "subject" LIKE \'Sample · %\'');
    check('15 "Remove sample data" deletes all of it', rm.status === 200 && Number(leftL[0].n) === 0 && Number(leftT[0].n) === 0, [rm.status, rm.body, leftL, leftT]);
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  try {
    const ids = Z.made.users;
    const q = (sql, ...p) => prisma.$executeRawUnsafe(sql, ...p).catch(() => 0);
    const marks = ids.map(() => '?').join(', ');
    if (ids.length) {
      await q(`DELETE FROM "CrmCampaignRecipient" WHERE "campaignId" IN (SELECT "id" FROM "CrmCampaign" WHERE "createdById" IN (${marks}))`, ...ids);
      await q(`DELETE FROM "CrmTicketComment" WHERE "ticketId" IN (SELECT "id" FROM "CrmTicket" WHERE "createdById" IN (${marks}))`, ...ids);
      for (const t of ['CrmCampaign', 'CrmTicket', 'CrmLead', 'CrmAccount', 'CrmContact', 'CrmDeal', 'CrmTask']) await q(`DELETE FROM "${t}" WHERE "ownerId" IN (${marks}) OR "createdById" IN (${marks})`, ...ids, ...ids); // eslint-disable-line no-await-in-loop
      await q(`DELETE FROM "CrmActivity" WHERE "byId" IN (${marks})`, ...ids);
      await q('DELETE FROM "CrmOptOut" WHERE "value" LIKE ?', `%crmx%${RUN}%`);
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    }
    console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  } catch (e) { console.log('cleanup problem', e.message); }
  await Z.finish();
})();
