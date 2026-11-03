#!/usr/bin/env node
// A finished AI interview on the jobs site moves the ATS by itself, and a finish without a score never blocks the next step
// (founder 2026-11-03: "akkada candidate ai interview ipoganey ikkada update avvali"; "asalu next step ki vellatledhu"). SANDBOX ONLY.
//   cd backend && TL_API=http://localhost:4011 node scripts/ai-interview-auto-test.js
const Z = require('./lib/zzfix')('AIA');

const { prisma, check, RUN } = Z;

(async () => {
  await Z.preclean();
  try {
    const B = require('../src/utils/jobPortalBridge'); // eslint-disable-line global-require
    const S = require('../src/utils/preAtsScreening'); // eslint-disable-line global-require
    const { PORTAL_APPLICATION_SOURCE } = require('../src/utils/atsVocab'); // eslint-disable-line global-require
    const cl = await prisma.client.create({ data: { name: `ZZTEST AIA Client ${RUN}`, location: 'Hyderabad' } });
    Z.made.clients.push(cl.id);
    const r = await prisma.requirement.create({ data: { title: `ZZTEST AIA Java ${RUN}`, clientId: cl.id, internal: true, hiringType: 'TeamLink Internal Hire', status: 'OPEN', department: 'IT', openings: 1, location: 'Hyderabad' } });
    Z.made.reqs.push(r.id);
    const c = await prisma.candidate.create({ data: { name: `ZZTEST AIA Cand ${RUN}`, email: `zz-aia-${RUN}@example.test`, phone: '9000000778' } });
    Z.made.cands.push(c.id);
    const a = await prisma.application.create({ data: { candidateId: c.id, requirementId: r.id, stage: 'AI_INTERVIEW_SCHEDULED', source: PORTAL_APPLICATION_SOURCE, aiInterviewStatus: 'Scheduled', resumeScore: 56 } });
    Z.made.apps.push(a.id);

    await B.syncAiInterview(a.id, { status: 'completed', score: null });
    let x = await prisma.application.findUnique({ where: { id: a.id } });
    const ev = await prisma.applicationStageEvent.findFirst({ where: { applicationId: a.id, toStage: 'AI_INTERVIEW_COMPLETED' } });
    check('1 finished on the jobs site (no score yet): the ATS moves to "AI interview done" by itself, on its history', x.stage === 'AI_INTERVIEW_COMPLETED' && x.aiInterviewStatus === 'Completed' && !!ev && ev.actorRole === 'SYSTEM', [x.stage, x.aiInterviewStatus, ev && ev.action]);
    const st = S.screeningOf({ ...x, stage: 'RECRUITER_REVIEW' }, await S.screenEvents([a.id]));
    check('2 a finished interview without a score does not block the next step', !st.blockers.some((b) => /AI interview/.test(b)), st.blockers);
    await B.syncAiInterview(a.id, { status: 'completed', score: 72 });
    x = await prisma.application.findUnique({ where: { id: a.id } });
    check('3 the score the jobs site works out later comes in on the next sync', x.aiInterviewScore === 72, x.aiInterviewScore);
    const again = await B.syncAiInterview(a.id, { status: 'completed', score: 72 });
    const evs = await prisma.applicationStageEvent.count({ where: { applicationId: a.id, toStage: 'AI_INTERVIEW_COMPLETED' } });
    check('4 the same result again changes nothing (one move, one history line)', !again && evs === 1, [again, evs]);
    await prisma.applicationStageEvent.deleteMany({ where: { applicationId: a.id } });
    await prisma.notification.deleteMany({ where: { title: { contains: `ZZTEST AIA Cand ${RUN}` } } }).catch(() => {});
  } catch (e) {
    console.log('TEST CRASHED', (e && e.stack) || e);
    Z.fail += 1;
  }
  console.log('cleanup left:', JSON.stringify(await Z.cleanup()));
  await Z.finish();
})();
