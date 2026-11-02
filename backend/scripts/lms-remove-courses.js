#!/usr/bin/env node
// ---------------------------------------------------------------------------
// LMS: REMOVE CHOSEN COURSES (founder 2026-11-02: "remove the course of the R&D training and Manufacturing document only one, there
// are duplicates, so one Manufacturing, the other one not remove").
//
//   node scripts/lms-remove-courses.js                           lists every course with a number (nothing is written) and SUGGESTS:
//                                                                every "R&D ... training" course, and of courses with the SAME
//                                                                title the one with fewer people assigned / newer (the other stays)
//   node scripts/lms-remove-courses.js --remove 3,7              dry run of exactly those numbers
//   node scripts/lms-remove-courses.js --remove 3,7 --apply --really-real    removes them (push-lms-course-removal-to-vps.ps1)
// Removed with each course: its materials (and their files), questions, assignments, batches, attempts and progress.
// A whole-database backup (VACUUM INTO) is written first. The list is oldest first, so a course added in between only gets a new
// number at the end; the push script shows the exact titles once more before YES.
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
const media = require('../src/utils/lmsMedia');

const norm = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');

(async () => {
  try {
    const courses = await prisma.course.findMany({ include: { _count: { select: { materials: true, questions: true, assignments: true } } }, orderBy: { createdAt: 'asc' } });
    const done = await prisma.courseAssignment.groupBy({ by: ['courseId'], where: { completed: true }, _count: true });
    const doneOf = new Map(done.map((d) => [d.courseId, d._count]));
    // suggestions
    const suggest = new Set();
    courses.forEach((c) => { if (/r\s*&\s*d|r and d/i.test(c.title) && /train/i.test(c.title)) suggest.add(c.id); });
    const byTitle = new Map();
    courses.forEach((c) => { const k = norm(c.title); if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(c); });
    for (const group of byTitle.values()) {
      if (group.length < 2) continue;
      // keep the one people use most (more assigned, then more content, then the older); suggest the rest
      const keep = [...group].sort((a, b) => (b._count.assignments - a._count.assignments) || ((b._count.materials + b._count.questions) - (a._count.materials + a._count.questions)) || (a.createdAt - b.createdAt))[0];
      group.forEach((c) => { if (c.id !== keep.id) suggest.add(c.id); });
    }
    console.log(`Courses on this database: ${courses.length}\n`);
    courses.forEach((c, i) => {
      console.log(`${suggest.has(c.id) ? '  >> ' : '     '}${String(i + 1).padStart(2)}. "${c.title}" | ${c.category || 'no category'} | made ${c.createdAt.toISOString().slice(0, 10)} | ${c._count.materials} materials, ${c._count.questions} questions, ${c._count.assignments} assigned (${doneOf.get(c.id) || 0} completed)`);
    });
    const suggested = courses.map((c, i) => (suggest.has(c.id) ? i + 1 : null)).filter(Boolean);
    console.log(`\nSUGGESTED to remove (>>): ${suggested.length ? suggested.join(',') : 'none'}`);
    const raw = val('--remove');
    if (!raw) { console.log('Nothing removed (list only).'); return; }
    const nums = [...new Set(raw.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n)))];
    const bad = nums.filter((n) => n < 1 || n > courses.length);
    if (!nums.length || bad.length) { console.error(`REFUSED: ${bad.length ? `no course number ${bad.join(', ')}` : 'no numbers given'}.`); process.exit(2); }
    const go = nums.map((n) => courses[n - 1]);
    console.log(`\nTO REMOVE (${go.length}):`);
    go.forEach((c) => console.log(`  "${c.title}" (made ${c.createdAt.toISOString().slice(0, 10)}, ${c._count.assignments} assigned)`));
    if (!APPLY) { console.log('\nDRY RUN: nothing was changed.'); return; }

    const target = dbArg ? path.resolve(dbArg) : null;
    const bakDir = target ? path.join(path.dirname(target), `lms-remove-courses-${STAMP}`) : path.join(os.homedir(), '.teamlink-backups', `lms-remove-courses-${STAMP}`);
    fs.mkdirSync(bakDir, { recursive: true });
    const bak = path.join(bakDir, 'before.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${bak.split(path.sep).join('/').replace(/'/g, "''")}'`);
    for (const c of go) {
      const files = (await prisma.courseMaterial.findMany({ where: { courseId: c.id }, select: { storedPath: true } })).map((m) => m.storedPath).filter(Boolean);
      await prisma.$transaction([
        prisma.courseAssessmentAttempt.deleteMany({ where: { courseId: c.id } }),
        prisma.courseAssignmentBatch.deleteMany({ where: { courseId: c.id } }),
        prisma.courseAssignment.deleteMany({ where: { courseId: c.id } }),
        prisma.course.delete({ where: { id: c.id } }), // materials, their progress and the questions go with it
      ]);
      files.forEach((f) => { try { media.remove(f); } catch { /* already gone */ } });
      console.log(`  removed "${c.title}" (${files.length} file(s))`);
    }
    try { await prisma.auditLog.create({ data: { userId: null, action: 'LMS courses removed by the founder\'s choice', entity: 'Course', entityId: 'many', toValue: go.map((c) => c.title).join(', ').slice(0, 480) } }); } catch { /* history only */ }
    console.log(`\nDONE: ${go.length} course(s) removed.\nBackup (the whole database before this): ${bak}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
