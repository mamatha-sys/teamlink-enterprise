#!/usr/bin/env node
/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// UNDO "COUNTED AS A JOINING" (founder 2026-11-10: "chakradhar status dropped ithey, joined ani endhuku chupisthundhi"). The
// October clean-up (scripts/mark-dropped-as-joined.js) moved Sai Chakradhar from Dropped to Joined so Education would read 9; the
// sheet says Drop, so he goes back. The step, joining status and joining date come back exactly as they were, read from the
// backup that script made just before its change (the newest ~/.teamlink-backups/mark-dropped-as-joined-*/before.db, or --backup).
// Nothing else on the record is touched; a history row and an audit row say what happened.
//
//   node scripts/undo-counted-as-joining.js --req REQ-0349 --name "Sai Chakradhar"            DRY RUN
//   TL_ALLOW_REAL_APPLY=1 node scripts/undo-counted-as-joining.js --req REQ-0349 --name "Sai Chakradhar" --apply --really-real
// SAFETY: VACUUM INTO backup first; exactly one matching application; it must be Joined now with a "Counted as a joining" row
// after its last other move; running it twice changes nothing new.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const argv = process.argv.slice(2);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes('--apply');
if (APPLY && !(argv.includes('--really-real') && process.env.TL_ALLOW_REAL_APPLY === '1')) {
  console.error('REFUSED: this writes to the REAL database. It needs --really-real AND TL_ALLOW_REAL_APPLY=1.');
  process.exit(2);
}
const reqCode = String(val('--req') || '').toUpperCase();
const name = String(val('--name') || '').trim();
if (!reqCode || !name) { console.error('Needs --req <code> --name "<candidate>"'); process.exit(2); }
const BACK = path.resolve(__dirname, '..');
process.chdir(BACK);
require('dotenv').config({ path: path.join(BACK, '.env') });
const prisma = require('../src/db');

const keyOf = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const ACTION = 'Counted as a joining';

function newestBackup() {
  if (val('--backup')) return val('--backup');
  const root = path.join(os.homedir(), '.teamlink-backups');
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('mark-dropped-as-joined-')).sort();
  for (let i = dirs.length - 1; i >= 0; i -= 1) { const f = path.join(root, dirs[i], 'before.db'); if (fs.existsSync(f)) return f; }
  return null;
}

(async () => {
  try {
    const req = await prisma.requirement.findUnique({ where: { reqCode }, select: { id: true, title: true } });
    if (!req) { console.log(`${reqCode}: no such requirement - nothing done`); return; }
    const apps = (await prisma.application.findMany({ where: { requirementId: req.id }, select: { id: true, candidateId: true, stage: true, joiningStatus: true, joiningDate: true, candidate: { select: { name: true } } } }))
      .filter((a) => keyOf(a.candidate && a.candidate.name) === keyOf(name));
    if (apps.length !== 1) { console.log(`${reqCode} ${req.title}: ${apps.length} applications of "${name}" - nothing done`); return; }
    const a = apps[0];
    const events = await prisma.applicationStageEvent.findMany({ where: { applicationId: a.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { action: true, fromStage: true, toStage: true, createdAt: true } });
    const last = events[0];
    if (!last || last.action !== ACTION || !['JOINED', 'HIRED'].includes(a.stage)) {
      console.log(`${reqCode}: "${a.candidate.name}" is ${a.stage}${a.joiningStatus ? ` / ${a.joiningStatus}` : ''}; the last move is ${last ? `"${last.action || last.toStage}"` : 'none'}, not "${ACTION}" - nothing to undo`);
      return;
    }
    const bakFile = newestBackup();
    if (!bakFile) { console.log('No backup of mark-dropped-as-joined found (~/.teamlink-backups) - nothing done. Pass --backup <before.db>.'); return; }
    const old = new DatabaseSync(bakFile, { readOnly: true });
    const was = old.prepare('SELECT "stage", "joiningStatus", "joiningDate" FROM "Application" WHERE "id" = ?').get(a.id);
    old.close();
    if (!was) { console.log(`The backup ${bakFile} has no such application - nothing done.`); return; }
    if (['JOINED', 'HIRED'].includes(was.stage)) { console.log(`In the backup "${a.candidate.name}" was already ${was.stage} - nothing to undo.`); return; }
    console.log(`${reqCode} ${req.title}: "${a.candidate.name}" is ${a.stage} / ${a.joiningStatus || '-'} (joining date ${a.joiningDate || 'none'})`);
    console.log(`   back to ${was.stage} / ${was.joiningStatus || '-'} (joining date ${was.joiningDate || 'none'}), as before the clean-up (${path.basename(path.dirname(bakFile))})`);
    if (!APPLY) { console.log('DRY RUN: nothing was changed.'); return; }
    const bakDir = path.join(os.homedir(), '.teamlink-backups', `undo-counted-as-joining-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(bakDir, { recursive: true });
    const bak = path.join(bakDir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${bak.split(path.sep).join('/').replace(/'/g, "''")}'`);
    await prisma.$transaction(async (tx) => {
      await tx.application.update({ where: { id: a.id }, data: { stage: was.stage, joiningStatus: was.joiningStatus, joiningDate: was.joiningDate } });
      await tx.applicationStageEvent.create({ data: { applicationId: a.id, candidateId: a.candidateId, fromStage: a.stage, toStage: was.stage, action: 'Back to Dropped', comment: `The founder's sheet says Drop: back to ${was.stage}${was.joiningStatus ? ` / ${was.joiningStatus}` : ''}, as before the October clean-up (2026-11-10).`, actorName: 'October joinings clean-up 2026-11-10' } });
      await tx.auditLog.create({ data: { action: `Not counted as a joining: ${a.candidate.name} (${reqCode}) back to ${was.joiningStatus || was.stage}`, entity: 'Application', entityId: a.id, fromValue: a.stage, toValue: was.stage, actorName: 'October joinings clean-up 2026-11-10' } });
    });
    console.log(`DONE. Backup (before this): ${bak}`);
  } finally { await prisma.$disconnect(); }
})().catch((e) => { console.error(String(e && e.stack ? e.stack : e).slice(0, 900)); process.exit(1); });
