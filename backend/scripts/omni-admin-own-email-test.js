// ---------------------------------------------------------------------------
// utils/omniDeptLogins.js: an admin opens Omni-Channel with their own email (founder 2026-11-06). Green Start and the database are stubbed: nothing real is touched.
//   node scripts/omni-admin-own-email-test.js
// ---------------------------------------------------------------------------
const Module = require('module');
const path = require('path');

const store = {};
const db = {
  appSetting: {
    findUnique: async ({ where }) => (store[where.key] ? { value: store[where.key] } : null),
    upsert: async ({ where, create }) => { store[where.key] = create.value; return {}; },
  },
  user: { findUnique: async () => null },
};
const load = Module._load;
Module._load = function stub(request, parent, isMain) {
  if (request === '../db' && parent && /[\\/]utils[\\/]omniDeptLogins\.js$/.test(parent.filename)) return db;
  return load.call(this, request, parent, isMain);
};
process.env.GREENSTART_SSO_SECRET = 'x'.repeat(40);
process.env.GREENSTART_SSO_EMAIL = 'admin@greenstart.demo';

const BACK = path.join(__dirname, '..');
const GI = require(path.join(BACK, 'src/utils/greenStartIntegrations'));
const O = require(path.join(BACK, 'src/utils/rcsOmniSync'));
const A = require(path.join(BACK, 'src/outreach/access'));
const SSO = require(path.join(BACK, 'src/utils/greenStartSso'));
const D = require(path.join(BACK, 'src/utils/omniDeptLogins'));

let pass = 0; let fail = 0;
const check = (name, ok, got) => { if (ok) { pass += 1; console.log(`  ok  ${name}`); } else { fail += 1; console.log(`  FAIL ${name}`, got === undefined ? '' : JSON.stringify(got)); } };

(async () => {
  SSO.ssoEmail = async () => 'admin@greenstart.demo';
  A.isAdmin = (u) => !!u.admin;
  let wss = [{ id: 'ws1', name: 'Medical' }, { id: 'ws2', name: 'Education' }];
  GI.signIn = async () => ({ token: 't' });
  GI.workspacesOf = async () => wss;
  const members = { ws1: [], ws2: [{ id: 'm1', email: 'dev@teamlink.in', roleKey: 'recruiter' }] };
  const calls = [];
  let refuse = '';
  const call = async (m, p, o = {}) => {
    calls.push(`${m} ${p} ${o.ws || ''}`.trim());
    if (m === 'GET') return { items: members[o.ws] || [] };
    if (m === 'POST' && p === '/team/members') {
      if (refuse) throw new Error(refuse);
      members[o.ws].push({ id: 'n', email: o.body.email, roleKey: o.body.roleKey });
      return {};
    }
    if (m === 'PATCH') { members[o.ws].forEach((x) => { x.roleKey = o.body.roleKey; }); return {}; }
    return { accessToken: 'a' };
  };
  O.call = call; GI.call = call;

  const dev = { id: 'u1', email: 'Dev@TeamLink.in', name: 'Developer', admin: true };
  const who = await D.loginFor(dev);
  check('the developer opens with their own email, not the demo one', who.email === 'dev@teamlink.in' && who.own && who.all, who);
  check('they are an Organization Admin of every workspace', members.ws1[0].roleKey === 'organization_admin' && members.ws2[0].roleKey === 'organization_admin', members);
  check('Green Start was asked once that it takes this sign-in', calls.filter((c) => c === 'POST /auth/teamlink').length === 1, calls);

  calls.length = 0;
  await D.loginFor(dev);
  check('opening again does not ask Green Start each time', calls.length === 0, calls);

  const sup = { id: 'u2', email: 'owner@teamlink.in', name: 'Owner', admin: true };
  refuse = 'Plan seat limit reached';
  const failed = await D.loginFor(sup);
  check('Green Start refuses their email: they still get in, and the reason is kept', failed.email === 'admin@greenstart.demo' && failed.all && !failed.own && /seat limit/.test(failed.ownFailed), failed);
  refuse = '';

  const co = await D.loginFor({ id: 'u3', email: 'admin@greenstart.demo', name: 'Co', admin: true });
  check('the company login itself stays as it is', co.email === 'admin@greenstart.demo' && !co.own, co);

  wss = [...wss, { id: 'ws3', name: 'Manufacturing' }];
  members.ws3 = [];
  const fresh = await D.loginFor({ id: 'u4', email: 'hr@teamlink.in', name: 'HR Admin', admin: true });
  check('a second admin gets their own too, in every workspace', fresh.own && ['ws1', 'ws2', 'ws3'].every((w) => members[w].some((m) => m.email === 'hr@teamlink.in')), members);

  console.log(`\nOmni-Channel admin own email: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
