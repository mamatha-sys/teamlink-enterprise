// ---------------------------------------------------------------------------
// OMNI-CHANNEL BY DEPARTMENT (founder 2026-11-02: "3 numbers kii 3 workspaces untaii, admin aa number ayite department kii assign
// chestaroo aa number nii mathram aa department vallu use chestaru, dhanikii ochina responses mathram aa vallakii kanipistayi, aa number
// ayite admin villakii estaroo dhani thoney campaigns run chestaru"; asked: Super Admin + Admin see every department).
//
//   1. A WhatsApp number's department (Administration > Integrations > WhatsApp, the number's access: one department) decides its
//      Omni-Channel workspace: "Teamlink <Department>" (an existing workspace of that name, or a new one). Written into the same
//      number -> workspace map the integrations sync already reads (AppSetting omni.gs.waMap, utils/greenStartIntegrations.js), as
//      { workspaceId, auto: true, dept }: a choice the Super Admin made by hand on Integrations > Omni-Channel stays as it is. The
//      default number with no department keeps the main workspace (as before, when nothing was mapped).
//   2. Each such department gets its own Omni-Channel login, a member of ONLY its department workspace, with Green Start's standard
//      "Team Leader" role (campaigns, conversations, templates, customers; no integrations, billing or workspace settings):
//      <company account>+omni-<department>@<its domain>. Made through Green Start's own API as the company account: the role is added
//      to the workspace (POST /team/roles/standard), then the person is added (POST /team/members) or, the first time, invited
//      (POST /team/invites -> its link), signed in once with the TeamLink one-click ticket (Green Start then makes an account with NO
//      organisation of its own, because it has a pending invitation) and the invitation accepted (POST /invites/accept).
//   3. loginFor(user): which Omni-Channel account a TeamLink person opens (routes/greenStartEmbed.js /sso-ticket). Super Admin and
//      Admin: the company account (every workspace). Everybody else: their department's login, so they see only their number, its
//      replies and their campaigns. No department login = no Omni-Channel, with the reason.
// Runs every hour, after a WhatsApp number is saved, and on "Set up department logins now". Nothing here stops TeamLink: every
// failure becomes words in the last result (AppSetting omni.gs.deptLogins). No token or secret is stored or returned.
// ---------------------------------------------------------------------------
const prisma = require('../db');

const KEY = 'omni.gs.deptLogins';
const WA_MAP_KEY = 'omni.gs.waMap';
const ROLE = 'team_leader';
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const getSetting = async (k, d) => parse(((await prisma.appSetting.findUnique({ where: { key: k } }).catch(() => null)) || {}).value, d);
const putSetting = (k, v) => prisma.appSetting.upsert({ where: { key: k }, create: { key: k, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
const canon = (name) => {
  try { return String(require('./bdeDesk').canonicalDepartment(name) || name || '').trim().toLowerCase(); } catch { return String(name || '').trim().toLowerCase(); } // eslint-disable-line global-require
};
// "medical" -> "Medical"; short names stay capitals ("hr" -> "HR", "r&d" -> "R&D", "bde" -> "BDE")
const title = (d) => String(d || '').trim().replace(/\s+/g, ' ').split(' ')
  .map((w) => (w.replace(/[^a-z]/gi, '').length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
  .join(' ');
const slug = (d) => canon(d).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'dept';
const wsNameFor = (dept) => `Teamlink ${title(dept)}`;

/** <company>+omni-<dept>@<domain> (the company mailbox receives anything Green Start ever mails it). */
function emailFor(dept, companyEmail) {
  const [local, domain] = String(companyEmail || '').trim().toLowerCase().split('@');
  if (!local || !domain) return '';
  return `${local.split('+')[0]}+omni-${slug(dept)}@${domain}`;
}

// a workspace that already stands for this department: "Teamlink Medical", "Medical", "... Medical"
function findWorkspace(wss, dept) {
  const d = canon(dept);
  const n = (w) => String(w.name || '').trim().toLowerCase();
  return wss.find((w) => n(w) === `teamlink ${d}`) || wss.find((w) => n(w) === d) || wss.find((w) => n(w).endsWith(` ${d}`)) || null;
}

let running = null;
/**
 * The whole job: numbers -> department workspaces (map), the integrations sync (numbers go there), department logins.
 * -> { at, ok, words, departments: [{ dept, workspace, number, email, state, words }] }
 */
async function run({ why = 'manual', pushChannels = true } = {}) {
  if (running) return running;
  running = (async () => {
    const result = { at: new Date().toISOString(), why, ok: false, words: '', departments: [] };
    try {
      const O = require('./rcsOmniSync'); // eslint-disable-line global-require
      const GSI = require('./greenStartIntegrations'); // eslint-disable-line global-require
      const SSO = require('./greenStartSso'); // eslint-disable-line global-require
      try { require('./waNumbers').bust(); } catch { /* read fresh after 30 s anyway */ } // eslint-disable-line global-require
      const token = await O.signIn();
      const company = await SSO.ssoEmail();
      let wss = await O.workspacesOf(token);
      if (!wss.length) throw new Error('The company Omni-Channel account has no workspace yet.');
      const view = await GSI.waMapView();
      const nums = view.numbers || [];
      const map = await getSetting(WA_MAP_KEY, {});
      const orgId = (wss[0] && wss[0].orgId) || null;

      // 1. each number with ONE department -> that department's workspace (hand-made choices stay)
      const plan = []; // { number, dept, ws }
      const taken = new Map(Object.entries(map).filter(([, v]) => v && v.workspaceId && !v.auto).map(([nid, v]) => [v.workspaceId, nid]));
      for (const n of nums) {
        const cur = map[n.id];
        if (cur && !cur.auto) { // the Super Admin chose by hand
          const ws = wss.find((w) => w.id === cur.workspaceId);
          const dept = (n.departments || []).length === 1 ? n.departments[0] : null;
          if (ws && dept) plan.push({ number: n, dept, ws, manual: true });
          continue; // eslint-disable-line no-continue
        }
        const depts = [...new Set((n.departments || []).map((d) => String(d).trim()).filter(Boolean))];
        if (depts.length > 1) {
          result.departments.push({ dept: '—', number: n.label, state: 'failed', words: `${n.label} is given to ${depts.length} departments (${depts.slice(0, 4).join(', ')}${depts.length > 4 ? ', ...' : ''}). Give it ONE department (Connections > WhatsApp > its access) and it gets that department's Omni-Channel workspace.` });
        }
        if (depts.length !== 1) {
          if (!depts.length && n.isDefault) {
            const main = wss[0];
            if (!taken.has(main.id)) { map[n.id] = { workspaceId: main.id, auto: true, dept: null }; taken.set(main.id, n.id); } else delete map[n.id];
          } else delete map[n.id];
          continue; // eslint-disable-line no-continue
        }
        const dept = depts[0];
        let ws = findWorkspace(wss, dept);
        if (ws && taken.has(ws.id) && taken.get(ws.id) !== n.id) {
          result.departments.push({ dept: title(dept), number: n.label, state: 'failed', words: `Workspace "${ws.name}" already has another WhatsApp number (one number per workspace in Omni-Channel).` });
          delete map[n.id];
          continue; // eslint-disable-line no-continue
        }
        if (!ws) {
          try {
            // eslint-disable-next-line no-await-in-loop
            ws = await O.call('POST', '/workspaces', { token, body: { ...(orgId ? { organizationId: orgId } : {}), name: wsNameFor(dept) } });
            wss = [...wss, { id: ws.id, name: ws.name, orgId }];
          } catch (err) {
            result.departments.push({ dept: title(dept), number: n.label, state: 'failed', words: `The workspace "${wsNameFor(dept)}" could not be made: ${err.message}` });
            delete map[n.id];
            continue; // eslint-disable-line no-continue
          }
        }
        map[n.id] = { workspaceId: ws.id, auto: true, dept: title(dept) };
        taken.set(ws.id, n.id);
        plan.push({ number: n, dept, ws });
      }
      await putSetting(WA_MAP_KEY, map);

      // 2. the numbers go to their workspaces (the integrations sync reads the map)
      const s = pushChannels ? await GSI.sync({ why: `department workspaces (${why})` }).catch((err) => ({ ok: false, words: err.message, workspaces: [] })) : { workspaces: [] };
      const waOf = (wsId) => {
        const w = (s.workspaces || []).find((x) => x.id === wsId);
        return w && w.channels && w.channels.whatsapp ? w.channels.whatsapp : null;
      };

      // 3. a login per department workspace
      const logins = (await getSetting(KEY, {})).departments || {};
      for (const p of plan) {
        const k = canon(p.dept);
        const email = emailFor(p.dept, company);
        const row = { dept: title(p.dept), workspace: p.ws.name, workspaceId: p.ws.id, number: p.number.label, email, whatsapp: waOf(p.ws.id) };
        try {
          if (!email) throw new Error('The company Omni-Channel account (its email) is not set: Integrations > Omni-Channel.');
          // eslint-disable-next-line no-await-in-loop
          const w = await ensureLogin(token, p.ws.id, email, title(p.dept));
          // only THIS workspace: the department login is taken out of every other one (a moved number, a hand-made add)
          // eslint-disable-next-line no-await-in-loop
          const out = await removeElsewhere(token, wss.filter((x) => x.id !== p.ws.id), email);
          Object.assign(row, { state: 'ready', words: out.length ? `${w} Taken out of ${out.join(', ')}.` : w });
        } catch (err) {
          Object.assign(row, { state: 'failed', words: String(err.message || err).slice(0, 300) });
        }
        row.at = new Date().toISOString();
        logins[k] = row;
        result.departments.push(row);
      }
      // a department no longer having a number keeps its login (and workspace) - nothing is deleted - but is shown as such
      for (const [k, row] of Object.entries(logins)) {
        if (!plan.some((p) => canon(p.dept) === k)) logins[k] = { ...row, number: null, words: `${row.words || ''} No WhatsApp number is given to ${row.dept} now.`.trim() };
      }
      result.ok = result.departments.length > 0 && result.departments.every((d) => d.state === 'ready');
      result.words = plan.length
        ? `${result.departments.filter((d) => d.state === 'ready').length} of ${result.departments.length} department${result.departments.length === 1 ? '' : 's'} ready in Omni-Channel.`
        : 'No WhatsApp number is given to a department yet (Administration > Integrations > WhatsApp: give each number one department).';
      await putSetting(KEY, { last: { at: result.at, ok: result.ok, words: result.words, why, rows: result.departments }, departments: logins });
    } catch (err) {
      result.words = String((err && err.message) || err).slice(0, 300);
      const st = await getSetting(KEY, {});
      await putSetting(KEY, { ...st, last: { at: result.at, ok: false, words: result.words, why } }).catch(() => {});
    }
    return result;
  })().finally(() => { running = null; });
  return running;
}

/** The department's own Omni-Channel login in ONE workspace with the Team Leader role. -> words */
async function ensureLogin(token, wsId, email, deptTitle) {
  const O = require('./rcsOmniSync'); // eslint-disable-line global-require
  const SSO = require('./greenStartSso'); // eslint-disable-line global-require
  await O.call('POST', '/team/roles/standard', { token, ws: wsId, body: { templateKey: ROLE } }); // adds it once; again = the same role
  const members = await O.call('GET', '/team/members?pageSize=100', { token, ws: wsId });
  const me = ((members && members.items) || []).find((m) => String((m.user && m.user.email) || m.email || '').toLowerCase() === email);
  if (me) {
    if (((me.role && me.role.key) || me.roleKey) !== ROLE) {
      await O.call('PATCH', `/team/members/${me.id}/role`, { token, ws: wsId, body: { roleKey: ROLE } });
      return 'Ready (role set to Team Leader).';
    }
    return 'Ready.';
  }
  try {
    await O.call('POST', '/team/members', { token, ws: wsId, body: { email, roleKey: ROLE } }); // the account exists already
    return 'Ready (added to the workspace).';
  } catch (err) {
    if (err.status !== 404 && !/USER_NOT_FOUND|No registered user/i.test(err.message)) throw err;
  }
  // first time: invite, sign the new login in once (an account with no organisation of its own), accept
  const inv = await O.call('POST', '/team/invites', { token, ws: wsId, body: { email, roleKey: ROLE } });
  const link = await O.call('POST', `/team/invites/${inv.id}/link`, { token, ws: wsId });
  const inviteToken = decodeURIComponent((/[?&#]token=([^&#]+)/.exec(String((link && link.url) || '')) || [])[1] || '');
  if (!inviteToken) throw new Error('Omni-Channel gave no invitation link.');
  const ticket = SSO.greenStartTicket({ email, name: `Omni-Channel ${deptTitle}`, externalUserId: `dept:${slug(deptTitle)}` });
  const dl = await O.call('POST', '/auth/teamlink', { body: { ticket } });
  if (!dl || !dl.accessToken) throw new Error('Omni-Channel asked the new department login for a second sign-in step.');
  await O.call('POST', '/invites/accept', { token: dl.accessToken, body: { token: inviteToken } });
  return 'Ready (new department login made).';
}

/** Take a department login out of the given workspaces. -> the names of the workspaces it was taken out of */
async function removeElsewhere(token, others, email) {
  const O = require('./rcsOmniSync'); // eslint-disable-line global-require
  const out = [];
  for (const w of others) {
    // eslint-disable-next-line no-await-in-loop
    const members = await O.call('GET', '/team/members?pageSize=100', { token, ws: w.id }).catch(() => null);
    const m = ((members && members.items) || []).find((x) => String((x.user && x.user.email) || x.email || '').toLowerCase() === email);
    if (!m) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    await O.call('DELETE', `/team/members/${m.id}`, { token, ws: w.id });
    out.push(w.name);
  }
  return out;
}

/**
 * Which Omni-Channel account this TeamLink person opens. -> { email } | { blocked: true, reason }
 * Super Admin / Admin: the company account. Everybody else: their department's login (made by run()).
 */
async function loginFor(reqUser) {
  const SSO = require('./greenStartSso'); // eslint-disable-line global-require
  const A = require('../outreach/access'); // eslint-disable-line global-require
  const WN = require('./waNumbers'); // eslint-disable-line global-require
  if (reqUser && A.isAdmin(reqUser)) return { email: await SSO.ssoEmail(), all: true };
  const u = reqUser && reqUser.id ? await prisma.user.findUnique({ where: { id: String(reqUser.id) } }).catch(() => null) : null;
  if (!u) return { blocked: true, reason: 'Your TeamLink login could not be read.' };
  const mine = new Set([...WN.departmentsOfUser(u), ...WN.departmentsOfUser(reqUser)]);
  const logins = (await getSetting(KEY, {})).departments || {};
  const hit = Object.entries(logins).find(([k, row]) => mine.has(k) && row.state === 'ready' && row.email);
  if (hit) return { email: hit[1].email, dept: hit[1].dept, workspace: hit[1].workspace };
  const names = [...mine].map(title).join(', ');
  return {
    blocked: true,
    reason: names
      ? `Omni-Channel is set up per department, and ${names} has no Omni-Channel workspace yet. An Admin gives your department a WhatsApp number (Administration > Integrations > WhatsApp), then it opens here.`
      : 'Omni-Channel is set up per department, and your TeamLink login has no department. Ask an Admin to set it.',
  };
}

let timer = null;
let soon = null;
function start() {
  if (require('./sandbox').isSandbox() || timer) return; // eslint-disable-line global-require
  timer = setInterval(() => { run({ why: 'hourly' }).catch(() => {}); }, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  const first = setTimeout(() => { run({ why: 'start' }).catch(() => {}); }, 2 * 60 * 1000);
  if (first.unref) first.unref();
}
/** After a WhatsApp number (or its department) is saved: once, a few seconds later. */
function schedule(why = 'number saved') {
  clearTimeout(soon);
  soon = setTimeout(() => { run({ why }).catch(() => {}); }, 5000);
  if (soon.unref) soon.unref();
}
const last = async () => getSetting(KEY, {});

module.exports = { run, ensureLogin, removeElsewhere, loginFor, start, schedule, last, emailFor, findWorkspace, title, KEY };
