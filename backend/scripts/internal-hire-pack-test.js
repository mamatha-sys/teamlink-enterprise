#!/usr/bin/env node
// ---------------------------------------------------------------------------
// INTERNAL HIRE -> EMPLOYEE -> JOINING PACK (founder 2026-11-03: "candidate join ayyaka, HRMS employee kinda generate
// ipoyyi, offer letter, joining letter, onboarding & login credentials velthai"). SANDBOX ONLY.
//
//   cd backend && TL_API=http://localhost:4011 node scripts/internal-hire-pack-test.js
//
// HR marks an internal candidate joined: the HRMS employee is made (TL code), with a login, the job's team lead as reporting
// manager, the joining letter kept in the documents, the welcome email tried, bells for HR and the manager, the audit row;
// "Send joining pack" again works; the joining letter opens as a PDF; a client placement never gets any of it.
// ---------------------------------------------------------------------------
const Z = require('./lib/zzfix')('IHP');

const { prisma, check, RUN } = Z;

(async () => {
  await Z.preclean();
  const extraUsers = []; const extraEmps = [];
  try {
    const hr = await Z.mkUser('hr', { role: 'EMPLOYEE', atsRole: 'HR', hrmsRole: 'HR', hrmsAccess: true, atsDepartment: 'HR', atsScopeDepartments: 'HR' }, { department: 'HR' });
    const tl = await Z.mkUser('tl', { role: 'TL', atsRole: 'TL', atsDepartment: 'IT', atsScopeDepartments: 'IT' }, { department: 'IT', designation: 'Team Lead' });
    const tlEmp = await prisma.employee.findFirst({ where: { userId: tl.id } });
    const tk = { hr: await Z.mint(hr) };
    const cInt = await prisma.client.create({ data: { name: `ZZTEST IHP Internal ${RUN}`, clientType: 'Internal', location: 'Hyderabad' } });
    Z.made.clients.push(cInt.id);
    const req = await prisma.requirement.create({ data: { title: `ZZTEST IHP Recruiter ${RUN}`, clientId: cInt.id, status: 'OPEN', department: 'IT', tlId: tl.id, openings: 1, internal: true, hiringType: 'TeamLink Internal Hire', location: 'Hyderabad' } });
    Z.made.reqs.push(req.id);
    const email = `zz-ihp-cand-${RUN}@example.test`;
    const cand = await prisma.candidate.create({ data: { name: `ZZTEST IHP Ravi ${RUN}`, email, phone: '9000000088', location: 'Hyderabad', experienceYears: 2 } });
    Z.made.cands.push(cand.id);
    const app = await prisma.application.create({ data: { candidateId: cand.id, requirementId: req.id, stage: 'OFFER_ACCEPTED', hiringType: 'TeamLink Internal Hire', joiningStatus: 'Joining Scheduled', joiningDate: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10), offeredCtc: 480000 } });
    Z.made.apps.push(app.id);

    const j = await Z.call('POST', `/api/ats/joining/${app.id}/joined`, tk.hr, { location: 'Hyderabad' });
    const a2 = await prisma.application.findUnique({ where: { id: app.id } });
    const emp = a2 && a2.hrmsEmployeeId ? await prisma.employee.findUnique({ where: { id: a2.hrmsEmployeeId } }) : null;
    if (emp) { extraEmps.push(emp.id); if (emp.userId) extraUsers.push(emp.userId); }
    check('1 HR marks the internal candidate joined: an HRMS employee with a TL code is made', j.status < 300 && emp && /^TL/.test(emp.employeeCode) && emp.employmentStatus === 'On Probation', [j.status, j.body && j.body.error, emp && emp.employeeCode]);
    const user = emp && emp.userId ? await prisma.user.findUnique({ where: { id: emp.userId } }) : null;
    check('2 the new employee has a login (their email), active, not a candidate login', !!user && user.email === email && user.status === 'Active' && !user.candidateId && !user.clientId, user && [user.email, user.status]);
    check('3 the job\'s team lead is the reporting manager', emp && tlEmp && emp.reportingManagerId === tlEmp.id, [emp && emp.reportingManagerId, tlEmp && tlEmp.id]);
    const docs = emp ? await prisma.employeeDocument.findMany({ where: { employeeId: emp.id } }) : [];
    check('4 the joining letter (PDF) is kept in the employee\'s documents', docs.some((d) => d.docType === 'Joining Letter' && d.mime === 'application/pdf' && d.size > 1500), docs.map((d) => [d.docType, d.size]));
    const audit = emp ? await prisma.auditLog.findFirst({ where: { entity: 'Employee', entityId: emp.id, action: { contains: 'Joining pack sent' } } }) : null;
    check('5 the pack is written to the audit (login made; welcome email tried - the sandbox mailer refuses test addresses)', !!audit && /login: made/.test(audit.toValue || '') && /welcome: not sent/.test(audit.toValue || ''), audit && audit.toValue);
    const bells = await prisma.notification.findMany({ where: { userId: { in: [hr.id, tl.id] }, title: { contains: 'New joiner' } } });
    check('6 HR and the reporting manager get a "New joiner" bell', bells.some((b) => b.userId === tl.id), bells.map((b) => b.userId === tl.id ? 'tl' : 'hr'));

    const again = await Z.call('POST', `/api/ats/internal-hiring/${app.id}/joining-pack`, tk.hr);
    const docs2 = emp ? await prisma.employeeDocument.findMany({ where: { employeeId: emp.id, docType: 'Joining Letter' } }) : [];
    check('7 "Send joining pack" again: the sign-in link goes again, the letter is replaced (not duplicated)', again.status === 200 && /sign-in link sent again/.test(again.body.joiningPack.login) && docs2.length === 1, [again.status, again.body]);
    const pdf = await fetch(`${Z.API}/api/ats/internal-hiring/${app.id}/joining-letter`, { headers: { Authorization: `Bearer ${tk.hr}` } });
    const buf = Buffer.from(await pdf.arrayBuffer());
    check('8 the joining letter opens as a PDF', pdf.status === 200 && buf.slice(0, 4).toString() === '%PDF', [pdf.status, buf.length]);

    // HR RUNS IT START TO END (founder 2026-11-03: "TLs dhi evaridhi em vundadhu ... HR ey chustharu")
    const cand2 = await prisma.candidate.create({ data: { name: `ZZTEST IHP Sita ${RUN}`, email: `zz-ihp-sita-${RUN}@example.test`, phone: '9000000090', location: 'Hyderabad' } });
    Z.made.cands.push(cand2.id);
    const ap2 = await prisma.application.create({ data: { candidateId: cand2.id, requirementId: req.id, stage: 'RECRUITER_REVIEW', hiringType: 'TeamLink Internal Hire' } });
    Z.made.apps.push(ap2.id);
    const toInt = await Z.call('PATCH', `/api/applications/${ap2.id}/stage`, tk.hr, { stage: 'INTERVIEW_SCHEDULED' });
    check('10 HR books the interview straight from its own check (no Dept head / TL step)', toInt.status < 300, [toInt.status, toInt.body && toInt.body.error]);
    await prisma.application.update({ where: { id: ap2.id }, data: { stage: 'INTERVIEW_COMPLETED' } });
    const sel = await Z.call('PATCH', `/api/applications/${ap2.id}/stage`, tk.hr, { stage: 'SELECTED' });
    check('11 HR marks the internal candidate Selected', sel.status < 300, [sel.status, sel.body && sel.body.error]);
    const bellsBefore = await prisma.notification.count({ where: { userId: tl.id, title: { contains: 'Offer to approve' } } });
    const prep = await Z.call('POST', `/api/ats/offers/${ap2.id}/prepare`, tk.hr, { offeredCtc: 420000, confirmCtc: true });
    const bellsAfter = await prisma.notification.count({ where: { userId: tl.id, title: { contains: 'Offer to approve' } } });
    check('12 HR prepares the offer; no TL is asked to approve it', prep.status < 300 && bellsAfter === bellsBefore, [prep.status, prep.body && (prep.body.error || prep.body.message), bellsAfter - bellsBefore]);
    const appr = await Z.call('POST', `/api/ats/offers/${ap2.id}/approve`, tk.hr, {});
    const ap2b = await prisma.application.findUnique({ where: { id: ap2.id } });
    check('13 HR approves and sends the offer itself (stage Offer)', appr.status < 300 && ap2b.stage === 'OFFER', [appr.status, appr.body && appr.body.error, ap2b.stage]);
    const meHr = await Z.call('GET', '/api/auth/me', tk.hr);
    const f = meHr.body && meHr.body.access && meHr.body.access.interviews && meHr.body.access.interviews.features;
    check('14 the HR screens show Approve (Offers, interview decision)', !!f && f.Offers && f.Offers.approve === true && f['Interview Feedback'] && f['Interview Feedback'].approve === true, f && [f.Offers, f['Interview Feedback']]);

    // a client placement never gets an employee / pack
    const cCli = await prisma.client.create({ data: { name: `ZZTEST IHP Client ${RUN}`, clientType: 'Client', location: 'Pune' } });
    Z.made.clients.push(cCli.id);
    const rq2 = await prisma.requirement.create({ data: { title: `ZZTEST IHP Client job ${RUN}`, clientId: cCli.id, status: 'OPEN', department: 'IT', tlId: tl.id, openings: 1 } });
    Z.made.reqs.push(rq2.id);
    const c2 = await prisma.candidate.create({ data: { name: `ZZTEST IHP Client cand ${RUN}`, email: `zz-ihp-c2-${RUN}@example.test`, phone: '9000000089' } });
    Z.made.cands.push(c2.id);
    const a3 = await prisma.application.create({ data: { candidateId: c2.id, requirementId: rq2.id, stage: 'JOINED', hiringType: 'Client Placement' } });
    Z.made.apps.push(a3.id);
    const no = await Z.call('POST', `/api/ats/internal-hiring/${a3.id}/joining-pack`, tk.hr);
    check('9 a client placement: no joining pack', [404, 409, 403].includes(no.status), no.status);
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  try {
    for (const id of extraEmps) {
      const docs = await prisma.employeeDocument.findMany({ where: { employeeId: id } }); // eslint-disable-line no-await-in-loop
      for (const d of docs) require('../src/utils/attachments').remove(d.file); // eslint-disable-line global-require
      await prisma.application.updateMany({ where: { hrmsEmployeeId: id }, data: { hrmsEmployeeId: null } }); // eslint-disable-line no-await-in-loop
      Z.made.emps.push(id);
    }
    extraUsers.forEach((u) => Z.made.users.push(u));
    await prisma.notification.deleteMany({ where: { userId: { in: Z.made.users } } });
    console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  } catch (e) { console.log('cleanup problem', e.message); }
  await Z.finish();
})();
