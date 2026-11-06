// ---------------------------------------------------------------------------
// utils/attachments.js for announcement pictures and videos (founder 2026-11-06). Writes only to a throwaway folder.
//   node scripts/announcement-media-test.js
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-media-'));
process.env.UPLOAD_DIR = dir;
const A = require('../src/utils/attachments');

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass += 1; console.log(`  ok  ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`); } };
const codeOf = (fn) => { try { fn(); return ''; } catch (e) { return e.code; } };

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]);
const html = Buffer.from('<html><script>alert(1)</script></html>');
const file = (contentType, data, filename = 'a.mp4') => ({ filename, contentType, data });

const m = A.store(file('video/mp4', mp4), { allowVideo: true });
check('an MP4 is stored with a name of ours, and can be read back', /^[a-f0-9]{32}\.mp4$/.test(m.billFile) && !!A.resolveStored(m.billFile));
const w = A.store(file('video/webm', webm), { allowVideo: true });
check('a WebM too', /\.webm$/.test(w.billFile) && !!A.resolveStored(w.billFile));
check('a video is refused where videos were not asked for (bills, QR codes)', codeOf(() => A.store(file('video/mp4', mp4))) === 'BAD_TYPE');
check('an HTML page called a video is refused', codeOf(() => A.store(file('video/mp4', html), { allowVideo: true })) === 'CONTENT_MISMATCH');
check('so is a video type that is not on the list', codeOf(() => A.store(file('video/x-matroska', mp4), { allowVideo: true })) === 'BAD_TYPE');
check('a stored name cannot walk out of the folder', A.resolveStored('../secret.mp4') === null);
A.remove(m.billFile);
check('a removed file is gone', A.resolveStored(m.billFile) === null);

// ---- the route: file, then notice, then only those it reaches can open it. The database and the login are stubbed.
const Module = require('module');
const http = require('http');
const express = require('express');

const rows = [];
const db = {
  announcement: {
    create: async ({ data }) => { const r = { id: `a${rows.length + 1}`, createdAt: new Date(), ...data }; rows.push(r); return r; },
    update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
    findMany: async () => rows,
    delete: async ({ where }) => { rows.splice(rows.findIndex((r) => r.id === where.id), 1); },
  },
  user: { findMany: async () => [] },
  notification: {
    rows: [],
    findMany: async ({ where }) => db.notification.rows.filter((n) => n.userId === where.AND[0].userId && !n.read),
    updateMany: async ({ where }) => { db.notification.rows.filter((n) => n.userId === where.AND[1].userId && n.title === where.AND[0].title).forEach((n) => { n.read = true; }); return {}; },
  },
};
const pauseDb = {
  announcement: db.announcement,
  notification: {
    rows: [],
    deleteMany: async ({ where }) => { pauseDb.notification.rows = pauseDb.notification.rows.filter((n) => !((where.title.in ? where.title.in.includes(n.title) : n.title === where.title) && (n.channel === 'In-App' || n.channel === null))); return {}; },
    findMany: async () => [...new Map(pauseDb.notification.rows.map((n) => [n.title, n])).values()].map((n) => ({ title: n.title })),
  },
};
let who = { id: 'u1', name: 'Asha' };
const load = Module._load;
Module._load = function stub(request, parent, isMain) {
  const from = parent ? parent.filename : '';
  if (request === '../db' && /routes[\\/]announcements\.js$/.test(from)) return db;
  if (request === '../db' && /announcementPause\.js$/.test(from)) return pauseDb;
  if (request === '../middleware/auth') return { requireAuth: (req, res, next) => { req.user = who; next(); }, requirePerm: () => (req, res, next) => next() };
  if (request === '../utils/audit') return { logAudit: async () => {} };
  if (request === '../utils/permissions') return { can: async () => true };
  if (request === '../utils/scope') return { scopeDepartments: () => [] };
  if (request === '../utils/audience') {
    return {
      list: () => [], parseAudience: () => null, parseChannels: () => [], storedColumns: () => ({}), describeDelivery: () => '',
      viewerContext: async (u) => u, reaches: (ctx) => ctx.id !== 'outsider', deliver: async () => ({ recipients: 0 }),
      resolveAudience: async () => ({ ok: true, employees: [], audience: {}, label: 'All' }),
    };
  }
  return load.call(this, request, parent, isMain);
};

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/a', require('../src/routes/announcements'));
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}/a`;
  const up = (buf, type, name) => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return fetch(`${base}/media`, { method: 'POST', body: f }); };
  const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'T', body: 'B', date: '2026-11-06', ...body }) });

  const pdf = await up(Buffer.from('%PDF-1.4 x'), 'application/pdf', 'a.pdf');
  check('a PDF is refused here', pdf.status === 400);
  const res = await up(mp4, 'video/mp4', 'camp video.mp4');
  const { mediaId, kind } = await res.json();
  check('a video is taken, and the answer says what it is', res.status === 201 && kind === 'video' && !!mediaId);
  who = { id: 'u2', name: 'Ravi' };
  check('somebody else cannot use that file on their notice', (await post({ mediaId })).status === 400);
  who = { id: 'u1', name: 'Asha' };
  const made = await (await post({ mediaId })).json();
  check('the notice carries it, and never shows the stored name', made.media && made.media.kind === 'video' && !JSON.stringify(made).includes(mediaId));
  const got = await fetch(`${base}/${made.id}/media`);
  const bytes = Buffer.from(await got.arrayBuffer());
  check('someone it reaches gets the same bytes, as a video', got.status === 200 && /video\/mp4/.test(got.headers.get('content-type')) && bytes.equals(mp4));
  who = { id: 'outsider', name: 'X' };
  check('someone it does not reach does not', (await fetch(`${base}/${made.id}/media`)).status === 403);
  who = { id: 'u1', name: 'Asha' };
  check('the same file cannot go on a second notice', (await post({ mediaId })).status === 400);
  // a new notice comes up on screen, once
  const notice = await (await post({ title: 'Holiday' })).json();
  db.notification.rows = [{ userId: 'u9', title: 'Announcement: Holiday', read: false, createdAt: new Date(), channel: 'In-App' }, { userId: 'u9', title: 'Announcement: Deleted long ago', read: false, createdAt: new Date(), channel: 'In-App' }];
  who = { id: 'u9', name: 'Mani' };
  const first = await (await fetch(`${base}/popup`)).json();
  check('an unread notice comes up for its reader; a bell row with no notice does not', first.length === 1 && first[0].id === notice.id, first);
  check('OK marks it read', (await fetch(`${base}/${notice.id}/seen`, { method: 'POST' })).status === 204);
  check('it does not come back', (await (await fetch(`${base}/popup`)).json()).length === 0);
  who = { id: 'outsider', name: 'X' };
  db.notification.rows = [{ userId: 'outsider', title: 'Announcement: Holiday', read: false, createdAt: new Date(), channel: 'In-App' }];
  check('someone it does not reach gets no popup', (await (await fetch(`${base}/popup`)).json()).length === 0);
  who = { id: 'u1', name: 'Asha' };
  rows.splice(rows.findIndex((r) => r.id === notice.id), 1);
  const Pause = require('../src/utils/announcementPause');
  pauseDb.notification.rows = [
    { title: 'Announcement: T', channel: 'In-App' }, { title: 'Announcement: T', channel: 'In-App' }, { title: 'Announcement: T', channel: 'Email' }, { title: 'Leave approved', channel: 'In-App' },
  ];
  await fetch(`${base}/${made.id}`, { method: 'DELETE' });
  check('deleting the notice removes the file', A.resolveStored(mediaId) === null);
  check('its bell rows leave every login; other notifications and the email log stay', pauseDb.notification.rows.length === 2 && pauseDb.notification.rows.every((n) => n.channel === 'Email' || n.title === 'Leave approved'), pauseDb.notification.rows);
  pauseDb.notification.rows = [{ title: 'Announcement: Diwali festival', channel: 'In-App' }, { title: 'Announcement: Still here', channel: 'In-App' }];
  rows.push({ id: 'keep', title: 'Still here' });
  const swept = await Pause.sweepDeleted();
  check('bell rows of a notice deleted earlier are swept, a live notice keeps its own', swept.length === 1 && pauseDb.notification.rows.length === 1 && pauseDb.notification.rows[0].title === 'Announcement: Still here', pauseDb.notification.rows);
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nAnnouncement media: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
