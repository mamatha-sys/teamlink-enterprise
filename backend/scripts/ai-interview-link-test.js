#!/usr/bin/env node
// The AI interview message carries the link to where the candidate takes it (founder 2026-11-03: "mail vachindhi, interview
// attend avamani candidate ki, but interview link raaledhu"). SANDBOX ONLY.
//   cd backend && TL_API=http://localhost:4011 node scripts/ai-interview-link-test.js
const Z = require('./lib/zzfix')('AIL');

const { prisma, check, RUN } = Z;

(async () => {
  await Z.preclean();
  try {
    const link = require('../src/utils/messageContext').appTokens({ requirement: {} }).aiInterviewLink; // eslint-disable-line global-require
    check('1 the link is the jobs site, My Applications', /\/jobs\/#\/candidate\/applications$/.test(link || ''), link);
    const c = await prisma.candidate.create({ data: { name: `ZZTEST AIL Cand ${RUN}`, email: `zz-ail-${RUN}@example.test`, phone: '9000000777' } });
    Z.made.cands.push(c.id);
    const cl = await prisma.client.create({ data: { name: `ZZTEST AIL Client ${RUN}`, location: 'Hyderabad' } });
    Z.made.clients.push(cl.id);
    const r = await prisma.requirement.create({ data: { title: `ZZTEST AIL Analyst ${RUN}`, clientId: cl.id, internal: true, hiringType: 'TeamLink Internal Hire', status: 'OPEN', department: 'IT', openings: 1, location: 'Hyderabad' } });
    Z.made.reqs.push(r.id);
    const a = await prisma.application.create({ data: { candidateId: c.id, requirementId: r.id, stage: 'AI_INTERVIEW_SCHEDULED', aiInterviewDeadline: '2026-11-06' } });
    Z.made.apps.push(a.id);
    const rows = await require('../src/utils/candidateComms').recordStageCommunications({ // eslint-disable-line global-require
      application: a, candidate: c, requirement: r, fromStage: 'AI_INTERVIEW_REQUIRED', toStage: 'AI_INTERVIEW_SCHEDULED', user: null,
    });
    const mail = rows.find((x) => x.channel === 'Email');
    check('2 the AI interview email holds the link', !!mail && mail.body.includes(link), mail && mail.body);
    check('3 every channel of that message holds it', rows.length > 0 && rows.every((x) => x.body.includes(link)), rows.map((x) => [x.channel, x.body.slice(-90)]));
    await prisma.candidateMessage.deleteMany({ where: { candidateId: c.id } });
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  await Z.finish();
})();
