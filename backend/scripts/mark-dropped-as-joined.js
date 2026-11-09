#!/usr/bin/env node
/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// A JOINING THE FOUNDER COUNTS, THOUGH THE PERSON DROPPED LATER (founder 2026-11-09: "education team - 9 raavali" - the October
// Education sheet has 9 rows, one of them Sai Chakradhar, joined Holy Mary 5 Oct, remark "Drop"; TeamLink had him Dropped).
// One application, named by requirement code and candidate name, goes back to Joined on the day given, with a history row.
//
//   node scripts/mark-dropped-as-joined.js --req REQ-0349 --name "Sai Chakradhar" --day 2026-10-05            DRY RUN
//   TL_ALLOW_REAL_APPLY=1 node scripts/mark-dropped-as-joined.js --req REQ-0349 --name "Sai Chakradhar" --day 2026-10-05 --apply --really-real
// SAFETY: VACUUM INTO backup first; exactly one matching application or nothing is done; running it twice changes nothing new.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes('--apply');
if (APPLY && !(argv.includes('--really-real') && process.env.TL_ALLOW_REAL_APPLY === '1')) {
  console.error('REFUSED: this writes to the REAL database. It needs --really-real AND TL_ALLOW_REAL_APPLY=1.');
  process.exit(2);
}
const reqCode = String(val('--req') || '').toUpperCase();
const name = String(val('--name') || '').trim();
const day = String(val('--day') || '');
if (!reqCode || !name || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { console.error('Needs --req <code> --name "<candidate>" --day yyyy-mm-dd'); process.exit(2); }
const BACK = path.resolve(__dirname, '..');
process.chdir(BACK);
require('dotenv').config({ path: path.join(BACK, '.env') });
const prisma = require('../src/db');

const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

(async () => {
  try {
    const req = await prisma.requirement.findUnique({ where: { reqCode }, select: { id: true, title: true } });
    if (!req) { console.log(`${reqCode}: no such requirement - nothing done`); return; }
    const apps = (await prisma.application.findMany({ where: { requirementId: req.id }, select: { id: true, candidateId: true, stage: true, joiningStatus: true, joiningDate: true, candidate: { select: { name: true } } } }))
      .filter((a) => keyOf(a.candidate && a.candidate.name) === keyOf(name));
    if (apps.length !== 1) { console.log(`${reqCode} ${req.title}: ${apps.length} applications of "${name}" - nothing done`); return; }
    const a = apps[0];
    if (['JOINED', 'HIRED'].includes(a.stage)) { console.log(`${reqCode}: "${a.candidate.name}" is already Joined (joining date ${a.joiningDate || 'none'}) - nothing to do`); return; }
    console.log(`${reqCode} ${req.title}: "${a.candidate.name}" is ${a.stage}${a.joiningStatus ? ` / ${a.joiningStatus}` : ''} -> Joined on ${day}`);
    if (!APPLY) { console.log('DRY RUN: nothing was changed.'); return; }
    const bakDir = path.join(os.homedir(), '.teamlink-backups', `mark-dropped-as-joined-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(bakDir, { recursive: true });
    const bak = path.join(bakDir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${bak.split(path.sep).join('/').replace(/'/g, "''")}'`);
    await prisma.$transaction(async (tx) => {
      await tx.application.update({ where: { id: a.id }, data: { stage: 'JOINED', joiningStatus: 'Joined', joiningDate: day } });
      await tx.applicationStageEvent.create({ data: { applicationId: a.id, candidateId: a.candidateId, fromStage: a.stage, toStage: 'JOINED', action: 'Counted as a joining', comment: `Joined on ${day} as in the founder's joinings sheet (the sheet says Drop; counted as a joining on the founder's word, 2026-11-09).`, actorName: 'October joinings clean-up 2026-11-09' } });
      await tx.auditLog.create({ data: { action: `Counted as a joining: ${a.candidate.name} (${reqCode}), joined ${day}`, entity: 'Application', entityId: a.id, toValue: 'JOINED', actorName: 'October joinings clean-up 2026-11-09' } });
    });
    console.log(`DONE. Backup (before this): ${bak}`);
  } finally { await prisma.$disconnect(); }
})().catch((e) => { console.error(String(e && e.stack ? e.stack : e).slice(0, 900)); process.exit(1); });
