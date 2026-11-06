// ---------------------------------------------------------------------------
// PAUSE AN ANNOUNCEMENT (founder 2026-10-27: "announcements lo pause option evvu; pause antey dashboard meeda and notifications lo
// kanipinchakudadhu").
//
// A paused announcement stays on file (HR sees it on the Announcements page with a "Paused" tag and a Resume button) but:
//   * it is not on the HRMS dashboard, nor on any employee's Announcements list, nor in the AI assistant's facts;
//   * the bell notifications it made are hidden: their status becomes "Paused" and every notification list leaves "Paused" rows out
//     (PAUSED_HIDE below). Resume puts them back as they were ("Delivered").
// The flag lives in the row's `delivery` JSON under `paused` (no migration - the same place the meeting link lives). A notification is
// tied to its announcement by what deliver() wrote: channel In-App, title "Announcement: <title>", made within minutes of the post.
// ---------------------------------------------------------------------------
const prisma = require('../db');

function deliveryOf(a) {
  try { return a && a.delivery ? JSON.parse(a.delivery) : {}; } catch { return {}; }
}
const isPaused = (a) => !!(deliveryOf(a).paused);
const pausedInfo = (a) => deliveryOf(a).paused || null;

// Prisma "where" piece for notification lists: rows not hidden by a paused announcement (a NULL status is a normal row).
const PAUSED_HIDE = { OR: [{ status: null }, { status: { not: 'Paused' } }] };

const notificationsOf = (a) => ({
  title: `Announcement: ${a.title}`,
  OR: [{ channel: 'In-App' }, { channel: null }],
  createdAt: { gte: new Date(new Date(a.createdAt).getTime() - 60000), lte: new Date(new Date(a.createdAt).getTime() + 30 * 60000) },
});

// paused = true / false. Returns the updated row.
async function setPaused(a, paused, user) {
  const d = deliveryOf(a);
  if (paused) d.paused = { at: new Date().toISOString(), by: (user && user.name) || null };
  else delete d.paused;
  const json = Object.keys(d).length ? JSON.stringify(d) : null;
  const row = await prisma.announcement.update({ where: { id: a.id }, data: { delivery: json } });
  await prisma.notification.updateMany({
    where: { AND: [notificationsOf(a), paused ? PAUSED_HIDE : { status: 'Paused' }] },
    data: { status: paused ? 'Paused' : 'Delivered' },
  }).catch(() => null);
  return row;
}

// A DELETED notice leaves every login (founder 2026-11-06: "employee logins lo delete chey"): its bell rows go with it, for everybody.
const removeNotifications = (a) => prisma.notification.deleteMany({ where: notificationsOf(a) }).catch(() => null);

// Bell rows of notices deleted before that rule, whose notice is gone: same title, no such announcement. Run once when the server starts.
async function sweepDeleted() {
  const rows = await prisma.notification.findMany({ where: { title: { startsWith: 'Announcement: ' }, OR: [{ channel: 'In-App' }, { channel: null }] }, select: { title: true }, distinct: ['title'] });
  const live = new Set((await prisma.announcement.findMany({ select: { title: true } })).map((a) => `Announcement: ${a.title}`));
  const gone = rows.map((r) => r.title).filter((t) => !live.has(t));
  if (gone.length) await prisma.notification.deleteMany({ where: { title: { in: gone }, OR: [{ channel: 'In-App' }, { channel: null }] } });
  return gone;
}

module.exports = { isPaused, pausedInfo, setPaused, removeNotifications, sweepDeleted, PAUSED_HIDE };
