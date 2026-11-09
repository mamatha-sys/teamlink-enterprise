#!/usr/bin/env node
/* eslint-disable no-console, no-await-in-loop */
// ---------------------------------------------------------------------------
// OCTOBER MEDICAL JOININGS: THE SAME PERSON JOINED TWICE (founder 2026-11-09, Keerthana's team: 13 joinings shown, 3 of them twice -
// "Just remove duplicates"). Each pair below is two profiles of one doctor, both Joined on the same requirement.
//
//   The profile whose application has the joining date entered is KEPT; the other one is folded into it with the app's own merge
//   (utils/candidateMerge.js): its history, follow-ups and notes move to the kept profile, nothing is lost, and Candidates >
//   Duplicates > Merges can UNDO it for 7 days. The joining list record of the folded application goes with it.
//
//   node scripts/merge-october-medical-duplicates.js [--pair REQ-0251]                     DRY RUN: what would be merged
//   TL_ALLOW_REAL_APPLY=1 node scripts/merge-october-medical-duplicates.js --pair REQ-0251 --apply --really-real
//   --pair <code>   only that pair (more than one: --pair A,B). The founder's count (Keerthana 12 of 13) says only ONE pair is the
//                   same person, so --apply needs it: the other pairs are two doctors and stay.
// SAFETY: VACUUM INTO backup first; a pair that is not exactly two joined profiles, or where it is unclear which one has the joining
// date, is left alone and said; running it twice changes nothing new.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
if (APPLY && !(argv.includes('--really-real') && process.env.TL_ALLOW_REAL_APPLY === '1')) {
  console.error('REFUSED: this writes to the REAL database. It needs --really-real AND TL_ALLOW_REAL_APPLY=1.');
  process.exit(2);
}
const BACK = path.resolve(__dirname, '..');
process.chdir(BACK);
require('dotenv').config({ path: path.join(BACK, '.env') });
const prisma = require('../src/db');
const MERGE = require('../src/utils/candidateMerge');

// requirement code -> what both names have in common (letters only, without "Dr")
const PAIRS = [
  { reqCode: 'REQ-0251', key: 'raviteja', said: 'Dr.Ravi teja / Dr RAVITEJASWARA' },
  { reqCode: 'REQ-0252', key: 'vijaykumar', said: 'Dr.Vijay Kumar / Dr. Vijay Kumar' },
  { reqCode: 'REQ-0539', key: 'divya', said: 'Dr.Divya / Dr . Divya' },
];
const pairArg = (() => { const i = argv.indexOf('--pair'); return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : null; })();
if (pairArg && pairArg.some((c) => !PAIRS.find((p) => p.reqCode === c))) { console.error(`--pair must be one of ${PAIRS.map((p) => p.reqCode).join(', ')}`); process.exit(2); }
if (APPLY && !pairArg) { console.error('REFUSED: say which pair is the same person: --pair <requirement code>.'); process.exit(2); }
const CHOSEN = pairArg ? PAIRS.filter((p) => pairArg.includes(p.reqCode)) : PAIRS;
const JOINED = ['JOINED', 'HIRED'];
const keyOf = (name) => String(name || '').toLowerCase().replace(/^\s*dr\b\.?/, '').replace(/[^a-z]/g, '');
const ACTOR = { id: null, name: 'October joinings clean-up 2026-11-09' };
const day = (v) => (v ? String(v).slice(0, 10) : 'none');
const tail = (p) => (p ? `…${String(p).replace(/\D/g, '').slice(-3)}` : 'no phone');

(async () => {
  try {
    const plan = [];
    for (const p of CHOSEN) {
      const req = await prisma.requirement.findUnique({ where: { reqCode: p.reqCode }, select: { id: true, title: true, department: true } });
      if (!req) { console.log(`${p.reqCode} ${p.said}: no such requirement - left alone`); continue; }
      const apps = (await prisma.application.findMany({
        where: { requirementId: req.id, stage: { in: JOINED } },
        select: { id: true, candidateId: true, joiningDate: true, createdAt: true, updatedAt: true, candidate: { select: { name: true, phone: true } } },
        orderBy: { createdAt: 'asc' },
      })).filter((a) => keyOf(a.candidate && a.candidate.name).includes(p.key));
      const head = `${p.reqCode} ${req.title}:`;
      if (apps.length < 2) { console.log(`${head} ${apps.length} joined profile${apps.length === 1 ? '' : 's'} for ${p.said} - nothing to merge (already done?)`); continue; }
      if (apps.length > 2) { console.log(`${head} ${apps.length} joined profiles for ${p.said} - more than two, left alone for a person to decide`); continue; }
      const dated = apps.filter((a) => a.joiningDate);
      if (dated.length !== 1) { console.log(`${head} ${dated.length ? 'both' : 'neither'} of the two has a joining date - left alone for a person to decide`); continue; }
      const keep = dated[0];
      const fold = apps.find((a) => a.id !== keep.id);
      const samePhone = keep.candidate.phone && fold.candidate.phone && keep.candidate.phone.replace(/\D/g, '').slice(-10) === fold.candidate.phone.replace(/\D/g, '').slice(-10);
      console.log(`${head}\n   keep  "${keep.candidate.name}" (joining date ${day(keep.joiningDate)}, phone ${tail(keep.candidate.phone)})\n   merge "${fold.candidate.name}" into it (joining date ${day(fold.joiningDate)}, phone ${tail(fold.candidate.phone)})${samePhone ? '' : '\n   NOTE: the phones are not the same - the other number is kept in a note on the profile'}`);
      plan.push({ ...p, keep, fold });
    }
    console.log(`\n${plan.length} of ${CHOSEN.length} pair${CHOSEN.length === 1 ? '' : 's'} to merge.`);
    if (!APPLY) { console.log('DRY RUN: nothing was changed.'); return; }
    if (!plan.length) return;

    const bakDir = path.join(os.homedir(), '.teamlink-backups', `merge-october-medical-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(bakDir, { recursive: true });
    const bak = path.join(bakDir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${bak.split(path.sep).join('/').replace(/'/g, "''")}'`);
    console.log(`Backup (before this): ${bak}`);

    for (const p of plan) {
      // the kept application is the one with the joining date: made the newest, so the merge keeps it (two Joined rank the same)
      await prisma.application.update({ where: { id: p.keep.id }, data: { updatedAt: new Date() } });
      const out = await MERGE.mergeCandidates({
        masterId: p.keep.candidateId, donorIds: [p.fold.candidateId], user: ACTOR, kind: 'MERGE',
        reason: `The same doctor joined twice on ${p.reqCode} (founder 2026-11-09: remove the October duplicates); the profile with the joining date is kept`,
      });
      const left = await prisma.application.findMany({ where: { requirementId: (await prisma.application.findUnique({ where: { id: p.keep.id }, select: { requirementId: true } })).requirementId, candidateId: p.keep.candidateId }, select: { id: true, joiningDate: true } });
      // the joining list record of the folded application has no application any more
      const gone = await prisma.$executeRawUnsafe('DELETE FROM "JoiningRecord" WHERE "applicationId" = ? AND NOT EXISTS (SELECT 1 FROM "Application" WHERE "id" = ?)', p.fold.id, p.fold.id).catch(() => 0);
      console.log(`${p.reqCode}: merged (undo for ${out.undoDays || 0} days in Candidates > Duplicates > Merges${out.mergeLogId ? `, ${out.mergeLogId}` : ''}); joined applications now ${left.length}, joining date ${day(left[0] && left[0].joiningDate)}; list records removed ${gone}`);
    }
    console.log('\nDONE.');
  } finally { await prisma.$disconnect(); }
})().catch((e) => { console.error(String(e && e.stack ? e.stack : e).slice(0, 900)); process.exit(1); });
