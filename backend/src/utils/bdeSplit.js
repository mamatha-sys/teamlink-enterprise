// ---------------------------------------------------------------------------
// TWO BDE SEATS ON ONE DESK (founder 2026-11-05: "bde-edu1 ki inka evaru raaledhu ... ahh position loki evaraina vachaka, appudu edu1
// sheet edu1 ki, edu2 sheete edu2 ki kanipincheylaa pettu. client andharu, 2 positions ki kanipinchali. req matram evarivi vallaki.
// present ithey mottham okarey handle chestunnaru").
//
//   One seat filled   nothing changes: that person handles the whole Education desk.
//   Both filled       (an active person on BDE-EDU-1 and on BDE-EDU-2; it starts by itself, no switch)
//     clients         both seats see all of them, as before
//     follow-ups      a line from the Edu-1 sheet shows to EDU-1, from the Edu-2 sheet to EDU-2; what people write shows to both
//     requirements    each seat its own: the job's BDE when one is named, else the sheet the client is in. A client in both sheets,
//                     or in neither, shows to both seats until a BDE is named on the job.
// The BDE TL and Admin always see everything. A seat still held by somebody who has left counts as empty.
// ---------------------------------------------------------------------------
const prisma = require('../db');
const { LEFT } = require('./leftLogin');
const { canonicalDepartment } = require('./bdeDesk');

const SEAT = /^BDE[\s_-]*EDU[\s_-]*(\d+)$/i;
const TTL_MS = 60000;
let held = null; // { at, seats: Map('1' -> [userId]) }
let sheets = null; // { at, map: Map(clientId -> Set('1', '2')) }

// "Edu - 2 Requirement Sheet (2).xlsx" -> '2'
const deskOfSheet = (name) => ((/edu\s*[-_ ]*(\d)/i.exec(String(name || '')) || [])[1]) || null;
const seatNumber = (code) => ((SEAT.exec(String(code || '').trim()) || [])[1]) || null;

async function holders() {
  if (held && Date.now() - held.at < TTL_MS) return held.seats;
  const rows = await prisma.positionAssignment.findMany({
    where: { toDate: null, position: { code: { contains: 'EDU' } } },
    select: { position: { select: { code: true } }, employee: { select: { userId: true, employmentStatus: true, user: { select: { status: true } } } } },
  });
  const seats = new Map();
  rows.forEach((r) => {
    const n = seatNumber(r.position.code);
    const e = r.employee;
    if (!n || !e || !e.userId || LEFT.includes(e.employmentStatus) || !e.user || e.user.status !== 'Active') return;
    if (!seats.has(n)) seats.set(n, []);
    seats.get(n).push(e.userId);
  });
  held = { at: Date.now(), seats };
  return seats;
}

// Which sheet(s) each client's imported lines came from.
async function sheetDesks() {
  if (sheets && Date.now() - sheets.at < TTL_MS * 10) return sheets.map;
  const rows = await prisma.$queryRawUnsafe(`SELECT DISTINCT substr(key, 11, instr(substr(key, 11), '.') - 1) AS clientId, json_extract(value, '$.sheet') AS sheet
    FROM "AppSetting" WHERE key LIKE 'clientlog.%' AND json_extract(value, '$.source') = 'sheet'`);
  const map = new Map();
  rows.forEach((r) => {
    const d = deskOfSheet(r.sheet);
    if (!d) return;
    if (!map.has(r.clientId)) map.set(r.clientId, new Set());
    map.get(r.clientId).add(d);
  });
  sheets = { at: Date.now(), map };
  return map;
}

// A BDE's seat codes -> null (nothing to split), or { seat, other, clientIds } (clientIds: the Education clients whose unnamed jobs are theirs).
async function viewOf(seatCodes = []) {
  const seat = seatCodes.map(seatNumber).find(Boolean);
  if (!seat) return null;
  const seats = await holders();
  const other = [...seats.keys()].find((n) => n !== seat);
  if (!other || !seats.has(seat)) return null;
  const map = await sheetDesks();
  const owners = await prisma.client.findMany({ where: { ownerDepartment: { not: null } }, select: { id: true, ownerDepartment: true } });
  const clientIds = owners.filter((c) => canonicalDepartment(c.ownerDepartment) === 'Education')
    .filter((c) => { const d = map.get(c.id); return !(d && d.size === 1 && d.has(other)); })
    .map((c) => c.id);
  return { seat, other, clientIds };
}

// May this login see this line of a client's follow-ups?
const seesLine = (user, e) => {
  const split = user && user.atsBdeSplit;
  return !split || e.source !== 'sheet' || deskOfSheet(e.sheet) !== split.other;
};

const forget = () => { held = null; sheets = null; };

module.exports = {
  viewOf, seesLine, deskOfSheet, forget,
};
