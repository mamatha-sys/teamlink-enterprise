#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LMS: REMOVE THE DEMO COURSES (founder 2026-11-02: "LMS module lo demo data remove chey vps lo").
//
// Demo = the four sample courses the first setup made (New Hire Orientation, POSH Awareness, Recruitment Fundamentals, Client
// Communication Standards), the "Chain Test Course <number>" rows a test left, and anything named ZZTEST. A demo-named course that
// has real content (a material or a question somebody added) is NOT removed: it is listed as "kept" so the founder can decide.
// Removed with each course: its assignments, assignment batches and assessment attempts (materials, questions and progress go with it).
//
//   node scripts/lms-remove-demo.js                         dry run: lists what would go (nothing is written)
//   node scripts/lms-remove-demo.js --apply --really-real   on the app's own database (push-lms-demo-removal-to-vps.ps1 does this)
//   node scripts/lms-remove-demo.js --db <copy.db> --apply  on a copy
// A whole-database backup (VACUUM INTO) is written before anything changes.
// ---------------------------------------------------------------------------
/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BACK = path.resolve(__dirname, '..');
const dbArg = val('--db');
const APPLY = has('--apply');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
if (APPLY && !dbArg && !has('--really-real')) {
  console.error("REFUSED: --apply on the app's own database needs --really-real. Run the dry run first, or use --db <copy>.");
  process.exit(2);
}
if (dbArg) process.env.DATABASE_URL = `file:${path.resolve(dbArg).split(path.sep).join('/')}`;
process.chdir(BACK);
require('dotenv').config({ path: path.join(BACK, '.env') });
const prisma = require('../src/db');

const DEMO_TITLES = ['new hire orientation', 'posh awareness', 'recruitment fundamentals', 'client communication standards'];
const isDemo = (title) => DEMO_TITLES.includes(String(title || '').trim().toLowerCase()) || /^chain test course \d+$/i.test(String(title || '').trim()) || /zztest/i.test(String(title || ''));

(async () => {
  try {
    const courses = await prisma.course.findMany({ include: { _count: { select: { materials: true, questions: true, assignments: true } } }, orderBy: { createdAt: 'asc' } });
    const go = []; const kept = []; const real = [];
    courses.forEach((c) => {
      if (!isDemo(c.title)) real.push(c);
      else if (c._count.materials || c._count.questions) kept.push(c);
      else go.push(c);
    });
    const line = (c) => `  "${c.title}" (${c.category || 'no category'}, ${c.createdAt.toISOString().slice(0, 10)}) | ${c._count.assignments} assigned, ${c._count.materials} materials, ${c._count.questions} questions`;
    console.log(`Courses on this database: ${courses.length}`);
    console.log(`\nDEMO - will be removed (${go.length}):`); go.forEach((c) => console.log(line(c)));
    console.log(`\nDemo name but has real content - KEPT, decide yourself (${kept.length}):`); kept.forEach((c) => console.log(line(c)));
    console.log(`\nReal courses - not touched (${real.length}):`); real.forEach((c) => console.log(line(c)));
    if (!go.length) { console.log('\nNothing to remove.'); return; }
    if (!APPLY) { console.log('\nDRY RUN: nothing was changed. Add --apply to remove the demo courses.'); return; }

    const target = dbArg ? path.resolve(dbArg) : null;
    const bakDir = target ? path.join(path.dirname(target), `lms-remove-demo-${STAMP}`) : path.join(os.homedir(), '.teamlink-backups', `lms-remove-demo-${STAMP}`);
    fs.mkdirSync(bakDir, { recursive: true });
    const bak = path.join(bakDir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${bak.split(path.sep).join('/').replace(/'/g, "''")}'`);

    for (const c of go) {
      const ids = { courseId: c.id };
      await prisma.$transaction([
        prisma.courseAssessmentAttempt.deleteMany({ where: ids }),
        prisma.courseAssignmentBatch.deleteMany({ where: ids }),
        prisma.courseAssignment.deleteMany({ where: ids }),
        prisma.course.delete({ where: { id: c.id } }),
      ]);
      console.log(`  removed "${c.title}"`);
    }
    try {
      await prisma.auditLog.create({ data: { userId: null, action: 'Removed the LMS demo courses', entity: 'Course', entityId: 'demo', toValue: go.map((c) => c.title).join(', ').slice(0, 480) } });
    } catch { /* history only */ }
    console.log(`\nDONE: ${go.length} demo course(s) removed.\nBackup (the whole database before this): ${bak}\nTo undo: stop TeamLink, copy the backup over the database file (remove its -wal / -shm), start TeamLink.`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
