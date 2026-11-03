#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CLIENT -> BDE -> TL -> RECRUITERS (founder 2026-11-03: "client official ga active loki vachaka, client oka req request ni
// post chestharu ... ahh bde ... ey tl ki assign cheyyali anukuntunnaro ... send kottestharu. then ahh tl dashboard lo ahh req
// display avuthadhi ... avaati nunchi vachey responses evariki kanipinchalo, valla ahh recruiters assign chestharu").
// SANDBOX ONLY.
//
//   cd backend && TL_API=http://localhost:4011 node scripts/client-flow-test.js
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('CFL');

const { prisma, check, RUN } = Z;

(async () => {
  await Z.preclean();
  try {
    const bde = await Z.mkUser('bde', { role: 'EMPLOYEE', atsRole: 'BDE', atsDepartment: 'BDE', atsScopeDepartments: 'BDE,IT' });
    const tl1 = await Z.mkUser('tl1', { role: 'TL', atsRole: 'TL', atsDepartment: 'IT', atsScopeDepartments: 'IT' });
    const tl2 = await Z.mkUser('tl2', { role: 'TL', atsRole: 'TL', atsDepartment: 'IT', atsScopeDepartments: 'IT' });
    const r1 = await Z.mkUser('rec1', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'IT', atsScopeDepartments: 'IT', team: `zz-cfl-${RUN}` });
    const r2 = await Z.mkUser('rec2', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'IT', atsScopeDepartments: 'IT', team: `zz-cfl-${RUN}` });
    const r3 = await Z.mkUser('rec3', { role: 'EMPLOYEE', atsRole: 'RECRUITER', atsDepartment: 'IT', atsScopeDepartments: 'IT', team: `zz-cfl-${RUN}` });
    const client = await prisma.client.create({ data: { name: `ZZTEST CFL Client ${RUN}`, location: 'Hyderabad', ownerDepartment: 'IT', bdeOwner: bde.name, clientType: 'Client', agreementStatus: 'SENT', agreementFeePercent: 8.33 } });
    Z.made.clients.push(client.id);
    const cl = await Z.mkUser('client', { role: 'CLIENT', atsRole: 'CLIENT', clientId: client.id, portalPerms: 'VIEW,REQUEST' });
    const tk = { cl: await Z.mint(cl), tl1: await Z.mint(tl1), tl2: await Z.mint(tl2), r1: await Z.mint(r1), r3: await Z.mint(r3) };

    // A. the client asks only once the agreement is Active
    const body = { title: `ZZTEST CFL Java Developer ${RUN}`, openings: 3, location: 'Hyderabad', skills: 'Java, Spring', notes: 'urgent' };
    const no = await Z.call('POST', '/api/portal/client/requirement-requests', tk.cl, body);
    check('1 a client whose agreement is not Active cannot send a requirement request', no.status === 409 && no.body && no.body.code === 'AGREEMENT_NOT_ACTIVE', [no.status, no.body]);
    await prisma.client.update({ where: { id: client.id }, data: { agreementStatus: 'ACTIVE' } });
    const yes = await Z.call('POST', '/api/portal/client/requirement-requests', tk.cl, body);
    const rq = await prisma.requirement.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' } });
    if (rq) Z.made.reqs.push(rq.id);
    check('2 once Active, the request is made for the client\'s BDE (a draft waiting to be opened)', yes.status < 300 && rq && rq.status === 'DRAFT' && rq.bdeId === bde.id, [yes.status, yes.body && yes.body.error, rq && [rq.status, rq.bdeId]]);

    // C. every team lead the BDE ticked sees it on their dashboard (not only the main one)
    await prisma.requirement.update({ where: { id: rq.id }, data: { status: 'OPEN', tlId: tl1.id } });
    // the BDE ticks two team leads (the same AppSetting row the BDE's form writes; the server re-reads it within 4 s)
    await require('../src/utils/reqTeamLeads').setExtras(rq.id, tl1.id, [tl2.id]); // eslint-disable-line global-require
    await new Promise((r) => { setTimeout(r, 5000); });
    const h1 = await Z.call('GET', '/api/dashboard/ats/home', tk.tl1);
    const h2 = await Z.call('GET', '/api/dashboard/ats/home', tk.tl2);
    const has = (h) => !!(h.body && (h.body.widgets || []).some((w) => w.id === 'new-reqs' && (w.rows || []).some((x) => x.id === rq.id)));
    check('3 the main TL and the second ticked TL both get "New requirements - post them"', has(h1) && has(h2), [h1.status, h2.status, has(h1), has(h2)]);

    // D. an API place (Facebook) is done right away, not left in a queue nobody runs: a dry run comes back finished at once
    await prisma.requirement.update({ where: { id: rq.id }, data: { jobDescription: 'Java, Spring Boot, REST APIs. 3-6 years.', salary: '6-9 LPA', experienceMin: 3, experienceMax: 6, department: 'IT' } }).catch(() => {});
    const t0 = Date.now();
    const fb = await Z.call('POST', `/api/job-publish/jobs/${rq.id}/publish`, tk.tl1, { portals: ['facebook'], dryRun: true });
    const one = fb.body && ((fb.body.results || fb.body.portals || [])[0] || fb.body);
    check('7 Facebook (an API place) runs at once: the answer comes back finished, not "Queued" (dry run)', fb.status < 300 && one && one.mode !== 'queued' && one.entry && one.entry.status !== 'QUEUED' && Date.now() - t0 < 60000, [fb.status, one && one.mode, one && one.reason, one && one.entry && one.entry.status]);

    // D2. a place that cannot be checked (LinkedIn Jobs): no "I posted it" - the first person through its TeamLink link makes it Live
    await prisma.requirementPosting.upsert({ where: { requirementId_source: { requirementId: rq.id, source: 'linkedin' } }, create: { requirementId: rq.id, source: 'linkedin', status: 'Integration Required' }, update: { status: 'Integration Required' } });
    const staffVisit = await fetch(`${Z.API}/api/public/job-portal/go/${rq.id}?src=linkedin`, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    await new Promise((r) => { setTimeout(r, 800); });
    const lp = await prisma.requirementPosting.findUnique({ where: { requirementId_source: { requirementId: rq.id, source: 'linkedin' } } });
    const sig = await prisma.$queryRawUnsafe('SELECT "kind", "count" FROM "PostingSignal" WHERE "requirementId" = ? AND "place" = ?', rq.id, 'linkedin');
    check('8 someone opens the job from the LinkedIn post\'s TeamLink link: LinkedIn turns Live by itself ("Seen live by TeamLink")', staffVisit.status === 302 && lp.status === 'Posted by hand' && /^Seen live by TeamLink/.test(lp.errorMessage || '') && sig.length === 1, [staffVisit.status, lp && [lp.status, lp.errorMessage], sig]);

    // E. responses: shared equally between the recruiters the TL ticks
    const sp = await Z.call('POST', `/api/requirements/${rq.id}/assign`, tk.tl1, { recruiterId: r1.id, recruiterIds: [r2.id], responseSplit: 'even' });
    check('4 the TL chooses "share the responses equally" between two recruiters', sp.status < 300, [sp.status, sp.body && sp.body.error]);
    const apps = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const c = await prisma.candidate.create({ data: { name: `ZZTEST CFL Cand ${i} ${RUN}`, email: `zz-cfl-${i}-${RUN}@example.test`, phone: `90000001${i}0`, currentSalary: '5L', expectedSalary: '7L' } });
      Z.made.cands.push(c.id);
      // eslint-disable-next-line no-await-in-loop
      const a = await prisma.application.create({ data: { candidateId: c.id, requirementId: rq.id, stage: 'NEW', source: 'Naukri' } });
      Z.made.apps.push(a.id); apps.push(a);
    }
    const owners = apps.map((a) => a.ownerRecruiterId);
    check('5 four responses arrive: 2 go to each recruiter', owners.filter((o) => o === r1.id).length === 2 && owners.filter((o) => o === r2.id).length === 2, owners);

    // E. the TL hands one response to a third recruiter: it becomes theirs and shows in their list
    const give = apps.find((a) => a.ownerRecruiterId === r1.id);
    const bulk = await Z.call('POST', '/api/applications/bulk', tk.tl1, { action: 'assign', recruiterId: r3.id, applicationIds: [give.id] });
    const after = await prisma.application.findUnique({ where: { id: give.id } });
    const rq2 = await prisma.requirement.findUnique({ where: { id: rq.id } });
    const l3 = await Z.call('GET', `/api/applications?requirementId=${rq.id}`, tk.r3);
    const l1 = await Z.call('GET', `/api/applications?requirementId=${rq.id}`, tk.r1);
    const ids = (x) => (Array.isArray(x.body) ? x.body : (x.body && (x.body.rows || x.body.applications)) || []).map((a) => a.id);
    check('6 TL "Assign to recruiter": the response becomes the third recruiter\'s, they join the job and see it; the first no longer does', bulk.status < 300 && after.ownerRecruiterId === r3.id && String(rq2.recruiterIds || '').includes(r3.id) && ids(l3).includes(give.id) && !ids(l1).includes(give.id), [bulk.status, bulk.body && (bulk.body.error || bulk.body.results), after.ownerRecruiterId, ids(l3).length, ids(l1).length]);
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  try {
    await prisma.appSetting.deleteMany({ where: { key: { in: Z.made.reqs.flatMap((id) => [`respsplit.${id}`, `reqreq.${id}`]) } } });
    for (const id of Z.made.reqs) await prisma.$executeRawUnsafe('DELETE FROM "PostingSignal" WHERE "requirementId" = ?', id).catch(() => {}); // eslint-disable-line no-await-in-loop
    for (const id of Z.made.reqs) await require('../src/utils/reqTeamLeads').setExtras(id, null, []).catch(() => {}); // eslint-disable-line no-await-in-loop, global-require
    await prisma.applicationFollowUp.deleteMany({ where: { applicationId: { in: Z.made.apps } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: Z.made.users } } });
    console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  } catch (e) { console.log('cleanup problem', e.message); }
  await Z.finish();
})();
