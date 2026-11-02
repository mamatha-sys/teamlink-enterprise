#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE FULL CRM (2026-11-02): settings, targets + performance report, forecast, funnel, going-cold deals, Excel / CSV import
// with duplicates skipped, bulk change, CSV export, proposals (PDF, email, accepted). SANDBOX ONLY.
//
//   cd backend && TL_API=http://localhost:4011 node scripts/crm-full-test.js
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('CRMF');

const { prisma, check, RUN } = Z;
const month = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
const day = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

async function raw(method, p, token, buf, ctype = 'application/octet-stream') {
  const r = await fetch(`${Z.API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': ctype, 'X-Forwarded-For': '10.9.1.1' }, body: buf });
  const b = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(b.toString('utf8')); } catch { /* not json */ }
  return { status: r.status, body: json, buf: b, type: r.headers.get('content-type') || '' };
}

(async () => {
  await Z.preclean();
  const S = await prisma.appSetting.findUnique({ where: { key: 'crm.settings' } }).catch(() => null);
  try {
    const bde = await Z.mkUser('bde', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const bde2 = await Z.mkUser('bde2', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const tl = await Z.mkUser('tl', { role: 'EMPLOYEE', atsRole: 'TL', atsDepartment: 'BDE', atsScopeDepartments: 'BDE' });
    const tk = { b: await Z.mint(bde), b2: await Z.mint(bde2), tl: await Z.mint(tl) };

    // settings
    const noSet = await Z.call('PUT', '/api/crm/settings', tk.b, { staleDays: 3 });
    const set = await Z.call('PUT', '/api/crm/settings', tk.tl, { sources: ['LinkedIn', 'Naukri', 'Referral'], staleDays: 7, stageProbability: { Meeting: 45 } });
    const me = await Z.call('GET', '/api/crm/me', tk.b);
    check('1 a BDE cannot change CRM settings; the BDE TL can, and the lists follow', noSet.status === 403 && set.status === 200 && me.body.lists.sources.includes('Naukri') && me.body.lists.sources.includes('Other') && me.body.lists.staleDays === 7 && me.body.lists.stageProbability.Meeting === 45, [noSet.status, set.status, me.body.lists]);

    // import: a CSV with a duplicate inside the file, one already in TeamLink, one without a company
    const L0 = await Z.call('POST', '/api/crm/leads', tk.b2, { company: `ZZTEST CRMF Existing ${RUN}`, phone: '9811100001' });
    const csv = [
      'Company Name,Contact Person,Mobile,Email,City,Lead Source,Rating',
      `ZZTEST CRMF Alpha ${RUN},Ravi,9811100011,zz-a-${RUN}@example.test,Hyderabad,Naukri,hot`,
      `ZZTEST CRMF Beta ${RUN},Sita,9811100012,,Pune,Website,`,
      `ZZTEST CRMF Alpha ${RUN},Ravi again,9811100013,,Hyderabad,,`,
      `Someone,,9811100001,,,,`,
      ',,,,,,',
      `,Only a person,9811100099,,,,`,
    ].join('\n');
    const dry = await raw('POST', `/api/crm/leads/import?dryRun=1&name=t.csv`, tk.b, Buffer.from(csv));
    check('2 import preview: 2 ready, the duplicate in the file, the one already in TeamLink and the row without a company are skipped', dry.status === 200 && dry.body.ready === 2 && dry.body.skipped.length === 3 && dry.body.skipped.some((s) => /Already in TeamLink: lead ZZTEST CRMF Existing/.test(s.reason)) && dry.body.skipped.some((s) => /this file/.test(s.reason)) && dry.body.skipped.some((s) => /No company/.test(s.reason)), dry.body);
    const imp = await raw('POST', `/api/crm/leads/import?name=t.csv`, tk.b, Buffer.from(csv));
    const mine = await Z.call('GET', '/api/crm/leads', tk.b);
    const alpha = mine.body.rows.find((l) => l.company === `ZZTEST CRMF Alpha ${RUN}`);
    check('3 import adds 2 leads to the BDE (source Naukri, rating Hot kept)', imp.body.created === 2 && alpha && alpha.source === 'Naukri' && alpha.rating === 'Hot' && alpha.ownerId === bde.id, [imp.body, alpha]);
    const forOther = await raw('POST', `/api/crm/leads/import?ownerId=${bde2.id}`, tk.b, Buffer.from(csv));
    check('4 a BDE cannot import for another BDE', forOther.status === 403, forOther.status);

    // bulk
    const ids = mine.body.rows.filter((l) => l.company.includes(`CRMF`) && l.company.includes(RUN)).map((l) => l.id);
    const bB = await Z.call('POST', '/api/crm/leads/bulk', tk.b, { ids, ownerId: bde2.id });
    const bS = await Z.call('POST', '/api/crm/leads/bulk', tk.b, { ids, rating: 'Warm', status: 'Qualified' });
    const bT = await Z.call('POST', '/api/crm/leads/bulk', tk.tl, { ids: [ids[0]], ownerId: bde2.id });
    const moved = await Z.call('GET', `/api/crm/leads/${ids[0]}`, tk.b2);
    check('5 bulk: a BDE sets status / rating on own leads but cannot give them away; the BDE TL can', bB.status === 403 && bS.body.changed === 2 && bT.body.changed === 1 && moved.status === 200 && moved.body.lead.status === 'Qualified' && moved.body.lead.rating === 'Warm', [bB.status, bS.body, bT.body, moved.status]);

    // a deal, a target and the performance report
    const cv = await Z.call('POST', `/api/crm/leads/${ids[1]}/convert`, tk.b, { openings: 4, avgCtc: 500000, feePercent: 10, expectedClose: day(3) });
    const deal = cv.body.deal;
    const mt = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b, { stage: 'Meeting' });
    check('6 the probability of a stage follows the settings (Meeting = 45%)', mt.body.deal && mt.body.deal.probability === 45, mt.body);
    const tB = await Z.call('PUT', '/api/crm/targets', tk.b, { month, ownerId: bde.id, amount: 500000 });
    const tT = await Z.call('PUT', '/api/crm/targets', tk.tl, { month, ownerId: bde.id, amount: 400000, deals: 2 });
    await Z.call('POST', '/api/crm/activities', tk.b, { kind: 'call', subject: 'Call 1', dealId: deal.id });
    await Z.call('POST', '/api/crm/activities', tk.b, { kind: 'meeting', subject: 'Meet 1', dealId: deal.id });
    const won = await Z.call('POST', `/api/crm/deals/${deal.id}/stage`, tk.b, { stage: 'Won' });
    const rp = await Z.call('GET', `/api/crm/reports?month=${month}`, tk.tl);
    const row = rp.body.performance.find((x) => x.ownerId === bde.id);
    check('7 targets are set by the BDE TL; the report shows calls, meetings, won value and 50% of target', tB.status === 403 && tT.status === 200 && won.status === 200 && row && row.calls === 1 && row.meetings === 1 && row.won === 1 && row.wonValue === 200000 && row.target === 400000 && row.achievement === 50, [tB.status, tT.status, row]);
    const rb = await Z.call('GET', `/api/crm/reports?month=${month}`, tk.b);
    check('8 a BDE\'s report holds only themselves; the funnel counts the imported leads', rb.body.performance.length === 1 && rb.body.performance[0].ownerId === bde.id && rb.body.funnel[0].count >= 1 && rb.body.funnel[3].count >= 1 && rb.body.funnel[4].count >= 1, [rb.body.performance.length, rb.body.funnel]);

    // forecast and going cold
    const d2 = await Z.call('POST', '/api/crm/deals', tk.b, { title: `ZZTEST CRMF Old deal ${RUN}`, accountId: cv.body.account.id, value: 90000, expectedClose: day(-2) });
    await prisma.$executeRawUnsafe('UPDATE "CrmDeal" SET "createdAt" = ? WHERE "id" = ?', new Date(Date.now() - 20 * 86400000).toISOString(), d2.body.deal.id);
    const rp2 = await Z.call('GET', '/api/crm/reports', tk.b);
    const late = rp2.body.forecast.find((f) => f.key === 'late');
    check('9 forecast: a deal whose close date passed is "Late"; nothing logged for 20 days = going cold (7-day setting)', late && late.count === 1 && late.value === 90000 && rp2.body.stale.some((s) => s.id === d2.body.deal.id && s.days >= 19), [rp2.body.forecast, rp2.body.stale]);

    // export
    const ex = await raw('GET', '/api/crm/export/leads', tk.b2);
    const txt = ex.buf.toString('utf8');
    check('10 export: CSV of the leads the login may see only', ex.status === 200 && /text\/csv/.test(ex.type) && txt.includes('Company') && txt.includes(`ZZTEST CRMF Existing ${RUN}`) && txt.includes(`ZZTEST CRMF Alpha ${RUN}`) && !txt.includes(`ZZTEST CRMF Beta ${RUN}`), [ex.status, txt.slice(0, 300)]);

    // proposals
    const pd = await Z.call('GET', `/api/crm/deals/${d2.body.deal.id}/proposals`, tk.b);
    const pc = await Z.call('POST', `/api/crm/deals/${d2.body.deal.id}/proposals`, tk.b, { ...pd.body.defaults, roles: [{ title: 'Java Developer', openings: 3, ctc: 900000 }], feePercent: 8.33, toEmail: `zz-client-${RUN}@example.test` });
    const prop = pc.body && pc.body.proposal;
    check('11 a proposal is made from the deal with the agreement defaults (number TLP-...)', pd.status === 200 && pd.body.defaults.guaranteeDays >= 0 && prop && /^TLP-\d{4}-\d{3}$/.test(prop.number), [pd.body, pc.body]);
    const pdf = await raw('GET', `/api/crm/proposals/${prop.id}/pdf`, tk.b);
    const pdfO = await raw('GET', `/api/crm/proposals/${prop.id}/pdf`, tk.b2);
    check('12 the proposal PDF opens for the owner, not for another BDE', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF' && pdf.buf.length > 2000 && pdfO.status === 404, [pdf.status, pdf.buf.length, pdfO.status]);
    const sd = await Z.call('POST', `/api/crm/proposals/${prop.id}/send`, tk.b, {});
    check('13 sending to a test address is refused by the mailer and says so (nothing marked sent)', sd.status === 502 && /not sent/i.test(sd.body.error), [sd.status, sd.body]);
    const ac = await Z.call('POST', `/api/crm/proposals/${prop.id}/status`, tk.b, { status: 'Accepted' });
    const dd = await Z.call('GET', `/api/crm/deals/${d2.body.deal.id}`, tk.b);
    check('14 Accepted moves the deal to Negotiation and is on the timeline', ac.status === 200 && dd.body.deal.stage === 'Negotiation' && dd.body.activities.some((a) => /Accepted/.test(a.subject)), [ac.status, dd.body.deal && dd.body.deal.stage]);

    // the sales team: anybody the Admin / Sales manager adds (founder 2026-11-02: "sales team kosam")
    const exec = await Z.mkUser('exec', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'IT', atsScopeDepartments: 'IT' });
    const tkE = await Z.mint(exec);
    const before = await Z.call('GET', '/api/crm/me', tkE);
    const meAuth0 = await Z.call('GET', '/api/auth/me', tkE);
    const ppl = await Z.call('GET', `/api/crm/people?q=${encodeURIComponent('CRMF exec')}`, tk.tl);
    const add = await Z.call('PUT', '/api/crm/settings', tk.tl, { salesTeam: [{ userId: exec.id, name: exec.name, role: 'rep' }] });
    const asRep = await Z.call('GET', '/api/crm/me', tkE);
    const meAuth1 = await Z.call('GET', '/api/auth/me', tkE);
    const owners = await Z.call('GET', '/api/crm/me', tk.tl);
    check('15 a person outside sales is refused until added to the sales team; then a Salesperson (own records), in the owner list, and the sidebar knows', before.status === 403 && meAuth0.body.crmRole === null && ppl.body.people.some((p) => p.id === exec.id) && add.status === 200 && asRep.body.role === 'bde' && meAuth1.body.crmRole === 'bde' && owners.body.owners.some((o) => o.id === exec.id) && owners.body.salesTeam.length === 1, [before.status, meAuth0.body && meAuth0.body.crmRole, add.status, asRep.body && asRep.body.role, meAuth1.body && meAuth1.body.crmRole]);
    await Z.call('PUT', '/api/crm/settings', tk.tl, { salesTeam: [{ userId: exec.id, name: exec.name, role: 'manager' }] });
    const asMgr = await Z.call('GET', '/api/crm/me', tkE);
    const allLeads = await Z.call('GET', '/api/crm/leads?status=all', tkE);
    const pplB = await Z.call('GET', '/api/crm/people?q=zz', tk.b);
    check('16 as Sales manager they see the whole team and may assign; a salesperson cannot change the team', asMgr.body.role === 'tl' && asMgr.body.canAssign && allLeads.body.rows.some((l) => l.ownerId === bde2.id) && pplB.status === 403, [asMgr.body && asMgr.body.role, pplB.status]);
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  try {
    const ids = Z.made.users;
    const q = (sql, ...p) => prisma.$executeRawUnsafe(sql, ...p).catch(() => 0);
    const marks = ids.map(() => '?').join(', ');
    if (ids.length) {
      await q(`DELETE FROM "CrmProposal" WHERE "createdById" IN (${marks})`, ...ids);
      await q(`DELETE FROM "CrmTarget" WHERE "ownerId" IN (${marks})`, ...ids);
      for (const t of ['CrmLead', 'CrmAccount', 'CrmContact', 'CrmDeal', 'CrmTask']) await q(`DELETE FROM "${t}" WHERE "ownerId" IN (${marks}) OR "createdById" IN (${marks})`, ...ids, ...ids); // eslint-disable-line no-await-in-loop
      await q(`DELETE FROM "CrmActivity" WHERE "byId" IN (${marks})`, ...ids);
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    }
    if (S) await prisma.appSetting.update({ where: { key: 'crm.settings' }, data: { value: S.value } }); else await prisma.appSetting.deleteMany({ where: { key: 'crm.settings' } });
    console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  } catch (e) { console.log('cleanup problem', e.message); }
  await Z.finish();
})();
