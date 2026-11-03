// CLIENT FOLLOW-UP LOG (founder 2026-11-03: "ee sheet lo followups vunnai kadha, avi anni ... import cheyyu. tharvatha comments
// enter cheskovali anna kuda option vundali. comments option recruiters ki, tls ki, bde ki andhariki vundali. vallu ey roju
// followup chesaro teluskovadaniki").
//
// One dated line per follow-up with a client - "02-11-2022 - interviews 4" - the way the BDE desk's Excel sheets keep it:
//   * anyone who works the client (BDE, BDE TL, TL, STL, recruiter, Admin) adds a comment for a day (default today);
//   * the client page and every requirement page of that client show the same log, newest day first, with who wrote it;
//   * an Excel sheet like "Edu - 1 Requirement Sheet" is imported line by line (preview -> pick the client -> import);
//     the same line is never imported twice.
// Rows live in appSetting ('clientlog.<clientId>.<id>'), like the client desk's follow-ups (utils/clientBusiness.js).
const crypto = require('crypto');
const prisma = require('../db');
const { logAudit } = require('./audit');
const S = require('./scope');
const D = require('./clientDedupe');

const PREFIX = 'clientlog.';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const keyOf = (clientId, id) => `${PREFIX}${clientId}.${id}`;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const hashOf = (clientId, onDate, note) => crypto.createHash('sha1').update(`${clientId}|${onDate}|${norm(note)}`).digest('hex').slice(0, 20);
function parse(row) {
  try { const v = JSON.parse(row.value); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

// ---- who may look / write ------------------------------------------------------------------------------
const ROLE_LABEL = { admin: 'Admin', mgmt: 'Manager', bde: 'BDE', tl: 'TL', stl: 'STL', recruiter: 'Recruiter', hr: 'HR', accounts: 'Accounts' };
function roleOf(user) {
  if (S.isBdeTl(user)) return { key: 'bdetl', label: 'BDE TL' };
  const k = S.atsViewRole(user);
  return { key: k, label: ROLE_LABEL[k] || '' };
}
// Managers / Asst Managers look only (they are view-only everywhere); clients, candidates and accounts never write here.
const mayWrite = (user) => ['admin', 'bdetl', 'bde', 'tl', 'stl', 'recruiter'].includes(roleOf(user).key);
const mayImport = (user) => ['admin', 'bdetl', 'bde'].includes(roleOf(user).key);

// The client this login may see the log of: one of their clients, or the client of a requirement they work on.
async function clientFor(user, { clientId, requirementId }) {
  if (requirementId) {
    const r = await prisma.requirement.findFirst({ where: { AND: [{ id: String(requirementId) }, S.requirementWhere(user)] }, select: { id: true, clientId: true, title: true, reqCode: true } });
    if (!r || !r.clientId) return null;
    const client = await prisma.client.findUnique({ where: { id: r.clientId }, select: { id: true, name: true } });
    return client ? { client, requirement: r } : null;
  }
  if (!clientId) return null;
  const id = String(clientId);
  let client = await prisma.client.findFirst({ where: { AND: [{ id }, S.clientWhere(user)] }, select: { id: true, name: true } });
  if (!client) {
    const r = await prisma.requirement.findFirst({ where: { AND: [{ clientId: id }, S.requirementWhere(user)] }, select: { id: true } });
    if (r) client = await prisma.client.findUnique({ where: { id }, select: { id: true, name: true } });
  }
  return client ? { client, requirement: null } : null;
}

async function entriesOf(clientId) {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: `${PREFIX}${clientId}.` } } });
  return rows.map(parse).filter(Boolean);
}
const publicEntry = (e, reqNames) => ({
  id: e.id, onDate: e.onDate, note: e.note, topic: e.topic || null,
  byName: e.byName || null, byRole: e.byRole || null, createdAt: e.createdAt,
  source: e.source || 'manual', sheet: e.sheet || null,
  requirementId: e.requirementId || null, requirementLabel: e.requirementId ? (reqNames[e.requirementId] || null) : null,
});
const newestFirst = (a, b) => String(b.onDate).localeCompare(String(a.onDate)) || String(b.createdAt).localeCompare(String(a.createdAt));

async function list(user, q) {
  const found = await clientFor(user, q);
  if (!found) return { status: 404, body: { error: 'This client is outside your area.' } };
  const all = (await entriesOf(found.client.id)).sort(newestFirst);
  const reqIds = [...new Set(all.map((e) => e.requirementId).filter(Boolean))];
  const reqs = reqIds.length ? await prisma.requirement.findMany({ where: { id: { in: reqIds } }, select: { id: true, title: true, reqCode: true } }) : [];
  const reqNames = Object.fromEntries(reqs.map((r) => [r.id, [r.reqCode, r.title].filter(Boolean).join(' · ')]));
  const people = [...new Set(all.map((e) => e.byName).filter(Boolean))].sort();
  return {
    status: 200,
    body: {
      client: found.client,
      requirement: found.requirement ? { id: found.requirement.id, label: [found.requirement.reqCode, found.requirement.title].filter(Boolean).join(' · ') } : null,
      entries: all.map((e) => publicEntry(e, reqNames)),
      people,
      lastOn: all.length ? all[0].onDate : null,
      canAdd: mayWrite(user),
      today: istToday(),
    },
  };
}

async function add(user, body) {
  if (!mayWrite(user)) return { status: 403, body: { error: 'Managers can read the follow-ups; the BDE, TL and recruiters write them.' } };
  const found = await clientFor(user, { clientId: body.clientId, requirementId: body.requirementId });
  if (!found) return { status: 404, body: { error: 'This client is outside your area.' } };
  const note = String(body.note || '').trim().slice(0, 2000);
  if (note.length < 3) return { status: 400, body: { error: 'Write what happened in the follow-up (at least 3 letters).' } };
  const onDate = String(body.onDate || istToday()).trim();
  if (!YMD.test(onDate)) return { status: 400, body: { error: 'Pick the date of the follow-up.' } };
  if (onDate > istToday()) return { status: 400, body: { error: 'The date cannot be in the future.' } };
  const role = roleOf(user);
  const id = crypto.randomBytes(6).toString('hex');
  const e = {
    id, clientId: found.client.id, requirementId: found.requirement ? found.requirement.id : null, onDate, note, topic: null,
    byId: user.id, byName: user.name || null, byRole: role.label || null, createdAt: new Date().toISOString(), source: 'manual',
    hash: hashOf(found.client.id, onDate, note),
  };
  await prisma.appSetting.create({ data: { key: keyOf(e.clientId, id), value: JSON.stringify(e), updatedById: user.id, updatedByName: user.name || null } });
  await logAudit({ userId: user.id, actorName: user.name || null, action: 'Client follow-up comment added', entity: 'Client', entityId: e.clientId, fieldLabel: 'Follow-up', toValue: onDate, reason: note.slice(0, 500) });
  return { status: 201, body: { ok: true, message: `Saved for ${onDate}.`, entry: publicEntry(e, {}) } };
}

// ---- the Excel sheet ------------------------------------------------------------------------------------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const NUM_DATE = /^\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4}|\d{2})(?!\d)/;
const WORD_DATE = /^\s*(\d{1,2})(?:st|nd|rd|th)?\s*[-\s./]\s*([A-Za-z]{3,9})\s*[-\s.,/]\s*(\d{4}|\d{2})(?!\d)/;
const ANY_DATE = /(\d{1,2})(?:st|nd|rd|th)?\s*[-./\s]\s*(\d{1,2}|[A-Za-z]{3,9})\s*[-./\s,]\s*(\d{4}|\d{2})(?!\d)/;
function ymd(d, m, y) {
  let day = Number(d); let mon = /^\d+$/.test(String(m)) ? Number(m) : MON[String(m).toLowerCase().slice(0, String(m).toLowerCase().startsWith('sept') ? 4 : 3)];
  let year = Number(y); if (String(y).length === 2) year += 2000;
  if (!mon) return null;
  if (mon > 12 && day <= 12) [day, mon] = [mon, day];
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || year < 2015 || year > 2030) return null;
  const dt = new Date(Date.UTC(year, mon - 1, day));
  if (dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}
// The date a line starts with, and the text after it.
function leadingDate(line) {
  const m = line.match(NUM_DATE) || line.match(WORD_DATE);
  if (!m) return null;
  const on = ymd(m[1], m[2], m[3]);
  if (!on) return null;
  const rest = line.slice(m[0].length).replace(/^[\s\-–:.,)]+/, '').trim();
  return { on, rest };
}

// Every cell that holds a follow-up log, by its header. Profile columns (contact, phone, location, link, mail) are not follow-ups.
const PROFILE_HEAD = /contact|number|phone|mobile|location|link|mail|college name|client name|company/i;
function parseSheet(buf, fileName) {
  const XLSX = require('xlsx'); // eslint-disable-line global-require
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const head = (rows[0] || []).map((h) => String(h || '').trim());
  const nameCol = Math.max(0, head.findIndex((h) => /college|client|company/i.test(h)));
  // Columns with no header after the named ones (N, O in the Edu sheet) are more status columns.
  const logCols = head.map((h, i) => i).filter((i) => i !== nameCol && !PROFILE_HEAD.test(head[i] || ''));
  const width = Math.max(...rows.map((r) => r.length), head.length);
  for (let i = head.length; i < width; i++) logCols.push(i);
  const label = (i) => head[i] || `Status (column ${XLSX.utils.encode_col(i)})`;
  const today = istToday();
  const future = [];
  const colleges = [];
  let cur = null;
  let undated = 0;
  const samples = [];
  rows.slice(1).forEach((r) => {
    if (!r.some((c) => String(c).trim())) return;
    const name = String(r[nameCol] || '').trim().replace(/\s+/g, ' ');
    if (name) { cur = { index: colleges.length, name, entries: [] }; colleges.push(cur); }
    if (!cur) return;
    logCols.forEach((ci) => {
      const cell = String(r[ci] || '');
      if (!cell.trim()) return;
      let open = null;
      const flush = () => {
        if (open && open.note.trim().length >= 2) {
          // a date after today is a typo in the sheet ("29-08-28"): listed in the preview, never imported on a wrong day
          if (open.on > today) { if (future.length < 20) future.push(`${cur.name.slice(0, 40)} · ${open.on}: ${open.note.trim().slice(0, 70)}`); else future.push(null); } else cur.entries.push({ onDate: open.on, note: open.note.trim().slice(0, 2000), topic: label(ci) });
        }
        open = null;
      };
      cell.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
        const d = leadingDate(line);
        if (d) { flush(); open = { on: d.on, note: d.rest || line }; return; }
        if (open) { open.note += `\n${line}`; return; }
        // "signed on 14th-Jan-2022": a date inside the first line still dates it.
        const m = line.match(ANY_DATE);
        const on = m ? ymd(m[1], m[2], m[3]) : null;
        if (on) { open = { on, note: line }; return; }
        undated += 1;
        if (samples.length < 8) samples.push(`${cur.name.slice(0, 40)} · ${label(ci)}: ${line.slice(0, 80)}`);
      });
      flush();
    });
  });
  return { fileName: String(fileName || 'sheet.xlsx').slice(0, 120), colleges: colleges.filter((c) => c.entries.length), emptyColleges: colleges.filter((c) => !c.entries.length).map((c) => c.name), undated, undatedSamples: samples, futureCount: future.length, futureSamples: future.filter(Boolean) };
}

// The client a college name in the sheet is, with up to 3 suggestions.
function matcher(clients, aliases) {
  const byKey = new Map();
  const put = (k, c, how) => { if (k && k.length >= 3 && !byKey.has(`${how}:${k}`)) byKey.set(`${how}:${k}`, c); };
  clients.forEach((c) => { put(D.fullKey(c.name), c, 'full'); put(D.baseKey(c.name), c, 'base'); put(D.coreKey(c.name), c, 'core'); });
  aliases.forEach((a) => { const c = clients.find((x) => x.id === a.clientId); if (c) put(a.aliasKey, c, 'full'); });
  const toks = (n) => new Set(D.tok(D.clean(n)));
  return (name) => {
    const inBr = (name.match(/\(([^)]{2,40})\)/) || [])[1] || '';
    // 100 = the same name; anything lower is "similar" and the preview asks to check it ("Aurora College(Ghatkesar)" vs "Aurora College - Uppal").
    const tries = [['full', D.fullKey(name), 100], ['full', D.fullKey(inBr), 95], ['base', D.baseKey(name), 90], ['core', D.coreKey(name), 85], ['core', D.coreKey(inBr), 80], ['base', D.fullKey(inBr), 80]];
    for (const [how, k, score] of tries) {
      const c = k && k.length >= 3 ? byKey.get(`${how}:${k}`) : null;
      if (c) return { pick: c.id, score, suggestions: [{ id: c.id, name: c.name, score }] };
    }
    const mine = toks(name.replace(/\([^)]*\)/g, ' '));
    const core = D.coreKey(name);
    const scored = clients.map((c) => {
      const theirs = toks(c.name);
      const inter = [...mine].filter((t) => theirs.has(t)).length;
      const jac = inter / Math.max(1, new Set([...mine, ...theirs]).size);
      const cc = D.coreKey(c.name);
      const near = core && cc && core.length >= 4 && D.osa(core, cc) <= D.thr(core.length) ? 75 : 0;
      return { id: c.id, name: c.name, score: Math.max(near, Math.round(jac * 70)) };
    }).filter((x) => x.score >= 35).sort((a, b) => b.score - a.score).slice(0, 3);
    const best = scored[0];
    return { pick: best && best.score >= 75 && (!scored[1] || scored[1].score < best.score) ? best.id : null, score: best ? best.score : 0, suggestions: scored };
  };
}

const PREVIEWS = new Map(); // token -> { userId, parsed, at }
const PREVIEW_MS = 30 * 60 * 1000;

async function importPreview(user, buf, fileName) {
  if (!mayImport(user)) return { status: 403, body: { error: 'Importing follow-ups is for the BDE team and Admin.' } };
  if (!buf || !buf.length) return { status: 400, body: { error: 'Choose the Excel file (.xlsx).' } };
  let parsed;
  try { parsed = parseSheet(buf, fileName); } catch { return { status: 400, body: { error: 'This file could not be read. Save it as .xlsx and try again.' } }; }
  if (!parsed.colleges.length) return { status: 400, body: { error: 'No dated follow-up lines were found (a line should start with a date like 02-11-2022).' } };
  const clients = await prisma.client.findMany({ where: { AND: [S.clientWhere(user), { OR: [{ clientType: null }, { clientType: { not: 'Internal' } }] }] }, select: { id: true, name: true, ownerDepartment: true }, orderBy: { name: 'asc' } });
  const aliases = await prisma.clientAlias.findMany({ select: { clientId: true, aliasKey: true } }).catch(() => []);
  const match = matcher(clients, aliases);
  const token = crypto.randomBytes(12).toString('hex');
  [...PREVIEWS.entries()].forEach(([k, v]) => { if (Date.now() - v.at > PREVIEW_MS) PREVIEWS.delete(k); });
  PREVIEWS.set(token, { userId: user.id, parsed, at: Date.now() });
  return {
    status: 200,
    body: {
      token, fileName: parsed.fileName,
      colleges: parsed.colleges.map((c) => {
        const m = match(c.name);
        const dates = c.entries.map((e) => e.onDate).sort();
        return { index: c.index, name: c.name, lines: c.entries.length, from: dates[0], to: dates[dates.length - 1], pick: m.pick, score: m.score, suggestions: m.suggestions };
      }),
      clients: clients.map((c) => ({ id: c.id, name: c.name })),
      totalLines: parsed.colleges.reduce((n, c) => n + c.entries.length, 0),
      emptyColleges: parsed.emptyColleges, undated: parsed.undated, undatedSamples: parsed.undatedSamples,
      futureCount: parsed.futureCount, futureSamples: parsed.futureSamples,
    },
  };
}

async function importCommit(user, { token, mapping }) {
  if (!mayImport(user)) return { status: 403, body: { error: 'Importing follow-ups is for the BDE team and Admin.' } };
  const p = PREVIEWS.get(String(token || ''));
  if (!p || p.userId !== user.id || Date.now() - p.at > PREVIEW_MS) return { status: 410, body: { error: 'The preview has expired. Choose the file again.' } };
  const map = mapping && typeof mapping === 'object' ? mapping : {};
  const CL = require('./clientLifecycle'); // eslint-disable-line global-require
  const role = roleOf(user);
  let added = 0; let duplicates = 0; let repeats = 0; let skipped = 0; const refused = []; const perClient = {};
  for (const c of p.parsed.colleges) {
    const clientId = map[c.index] ? String(map[c.index]) : '';
    if (!clientId) { skipped += c.entries.length; continue; }
    // eslint-disable-next-line no-await-in-loop
    const client = await prisma.client.findFirst({ where: { AND: [{ id: clientId }, S.clientWhere(user)] } });
    if (!client || !CL.ownsClient(user, client)) { refused.push(c.name); continue; }
    // eslint-disable-next-line no-await-in-loop
    const have = new Set((await entriesOf(client.id)).map((e) => e.hash));
    const seen = new Set();
    const data = [];
    c.entries.forEach((e) => {
      const hash = hashOf(client.id, e.onDate, e.note);
      if (have.has(hash)) { duplicates += 1; return; }
      if (seen.has(hash)) { repeats += 1; return; } // the same day and words twice in the sheet
      seen.add(hash);
      const id = crypto.randomBytes(6).toString('hex');
      const row = { id, clientId: client.id, requirementId: null, onDate: e.onDate, note: e.note, topic: e.topic, byId: user.id, byName: user.name || null, byRole: role.label || null, createdAt: new Date().toISOString(), source: 'sheet', sheet: p.parsed.fileName, hash };
      data.push({ key: keyOf(client.id, id), value: JSON.stringify(row), updatedById: user.id, updatedByName: user.name || null });
    });
    for (let i = 0; i < data.length; i += 200) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.appSetting.createMany({ data: data.slice(i, i + 200) });
    }
    added += data.length;
    if (data.length) {
      perClient[client.name] = (perClient[client.name] || 0) + data.length;
      // eslint-disable-next-line no-await-in-loop
      await logAudit({ userId: user.id, actorName: user.name || null, action: 'Client follow-ups imported', entity: 'Client', entityId: client.id, fieldLabel: 'Follow-up', toValue: `${data.length} lines`, reason: `From ${p.parsed.fileName} (${c.name})`.slice(0, 500) });
    }
  }
  PREVIEWS.delete(String(token));
  return {
    status: 200,
    body: {
      ok: true, added, duplicates, repeats, skipped, refused, clients: Object.keys(perClient).length,
      message: `${added} follow-up line${added === 1 ? '' : 's'} imported into ${Object.keys(perClient).length} client${Object.keys(perClient).length === 1 ? '' : 's'}${duplicates ? `; ${duplicates} were already there` : ''}${repeats ? `; ${repeats} were written twice in the sheet and kept once` : ''}.`,
    },
  };
}

module.exports = { list, add, importPreview, importCommit, parseSheet, leadingDate, matcher, mayWrite, mayImport, PREFIX };
