#!/usr/bin/env node
/**
 * Delete a repeated leave type (routes/leave.js DELETE /types/:id). SANDBOX ONLY: a COPY of the sandbox database, on a private port.
 *   node scripts/leave-type-delete-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const SOURCE = process.env.TEST_SOURCE_DB || path.resolve(__dirname, '..', 'prisma', 'sandbox.db');
const COPY = path.join(os.tmpdir(), `zz-lt-${process.pid}.db`).split(path.sep).join('/');
const src = new DatabaseSync(SOURCE, { readOnly: true });
src.exec(`VACUUM INTO '${COPY}'`);
src.close();
const PORT = 4091;
const SECRET = 'zz-lt-secret';
const env = { ...process.env, PORT: String(PORT), TEAMLINK_SANDBOX: '1', TEST_MODE: '1', DATABASE_URL: `file:${COPY}`, JWT_SECRET: SECRET };
Object.assign(process.env, env);
const prisma = require('../src/db');
const jwt = require('jsonwebtoken');
const { resolveIdentity, tokenPayload } = require('../src/utils/identity');

let failed = 0; let total = 0;
const check = (name, ok, extra) => { total += 1; if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`FAIL  ${name}\n      ${JSON.stringify(extra)}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['src/index.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  try {
    const boss = (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'Active' } })).find((u) => !/zz/i.test(u.name));
    await prisma.user.update({ where: { id: boss.id }, data: { passwordChangedAt: new Date(), passwordResetRequired: false } });
    const token = jwt.sign(tokenPayload(await resolveIdentity(boss.id, boss)), SECRET, { expiresIn: '1h' });
    const call = async (method, p) => {
      for (let i = 0; i < 60; i += 1) {
        try {
          const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method, headers: { Authorization: `Bearer ${token}` } });
          return { status: r.status, body: await r.json().catch(() => ({})) };
        } catch { await sleep(1000); }
      }
      throw new Error('server did not start');
    };
    const R = String(Date.now()).slice(-6);
    const a = await prisma.leaveType.create({ data: { code: `ZA${R}`, name: `ZZTEST Sick ${R}` } });
    const b = await prisma.leaveType.create({ data: { code: `ZB${R}`, name: `zztest sick ${R} ` } });
    const r1 = await call('DELETE', `/leave/types/${b.id}`);
    check('a repeated name is deleted', r1.status === 200 && !(await prisma.leaveType.findUnique({ where: { id: b.id } })), r1);
    check('the other one of that name stays', !!(await prisma.leaveType.findUnique({ where: { id: a.id } })));
    const emp = await prisma.employee.findFirst({ select: { id: true } });
    // plain SQL: the sandbox copy may be a few columns behind the schema
    await prisma.$executeRawUnsafe('INSERT INTO "LeaveRequest" ("id", "employeeId", "type", "fromDate", "toDate") VALUES (?, ?, ?, ?, ?)', `zzlt${R}`, emp.id, a.name, '2026-11-20', '2026-11-20');
    const r2 = await call('DELETE', `/leave/types/${a.id}`);
    check('the last one of a name that leave uses is refused (Pause instead)', r2.status === 409 && !!(await prisma.leaveType.findUnique({ where: { id: a.id } })), r2);
  } catch (e) { failed += 1; console.log('FAIL  ', e.message); } finally {
    server.kill();
    await prisma.$disconnect().catch(() => {});
    console.log(failed ? `\n${failed} of ${total} checks FAILED` : `\nAll ${total} checks passed`);
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(COPY + s); } catch { /* none */ } }
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
