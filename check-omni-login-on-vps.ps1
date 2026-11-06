# ---------------------------------------------------------------------------
# WHAT DOES ONE OMNI-CHANNEL LOGIN SEE ON THE LIVE SITE? (founder 2026-11-06)
#
#   .\check-omni-login-on-vps.ps1 -Email developer@tmlink.in
#
# Read only. For that email: is there an account, and for each workspace its role, WhatsApp and social accounts.
# No token, key or password is printed. Copy the whole output back to Claude.
# ---------------------------------------------------------------------------
param([Parameter(Mandatory = $true)][string]$Email)
$ErrorActionPreference = 'Stop'
if ($Email -notmatch '^[^\s@''"]+@[^\s@''"]+\.[^\s@''"]+$') { throw "That is not an email address: $Email" }
$VpsHost = 'root@72.61.233.104'
$script = @'
set -e
export CHECK_EMAIL="__EMAIL__"
cd /opt/teamlink-enterprise/backend
node -e '
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const email = process.env.CHECK_EMAIL;
  const u = await p.user.findFirst({ where: { email: { equals: email } }, select: { name: true, role: true, active: true } }).catch(() => null);
  console.log(`TeamLink login        : ${u ? `${u.name}, role ${u.role}` : "no TeamLink login has exactly this email"}`);
  const r = await p.appSetting.findUnique({ where: { key: "omni.gs.adminLogins" } }).catch(() => null);
  const all = r ? JSON.parse(r.value) : {};
  console.log(`Own Omni-Channel login: ${all[email] ? `made, in ${all[email].length} workspace(s)` : "not made yet (it is made when this login opens Omni-Channel)"}`);
  const c = await p.appSetting.findUnique({ where: { key: "omni.gs.ssoEmail" } }).catch(() => null);
  console.log(`Company account       : ${c ? JSON.parse(c.value) : "(from .env)"}`);
})().catch((e) => console.log(`TeamLink check failed: ${String(e.message).split("\n")[0]}`)).finally(() => p.$disconnect());
'
cd /opt/green-start/gs-api
node - <<'JS'
const fs = require('fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l)) || '';
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '').replace(/\?.*$/, '');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const me = (await c.query('SELECT id, email, status, "isSuperAdmin" FROM users WHERE "emailLower" = $1', [process.env.CHECK_EMAIL])).rows[0];
    if (!me) { console.log('Green Start account   : none yet'); }
    else console.log(`Green Start account   : ${me.email}, ${me.status}${me.isSuperAdmin ? ', platform administrator' : ''}`);
    const mine = me ? (await c.query(`SELECT m."workspaceId" id, r.key role, m.status FROM workspace_members m JOIN roles r ON r.id = m."roleId" WHERE m."userId" = $1`, [me.id])).rows : [];
    const roles = new Map(mine.map((m) => [m.id, `${m.role}${m.status === 'ACTIVE' ? '' : ` (${m.status})`}`]));
    const wss = (await c.query(`SELECT w.id, w.name, o.name org FROM workspaces w JOIN organizations o ON o.id = w."organizationId" ORDER BY o.name, w.name`)).rows;
    for (const w of wss) {
      const ints = (await c.query(`SELECT provider, status, "displayName" FROM integrations WHERE "workspaceId" = $1 AND status <> 'DISCONNECTED' ORDER BY provider`, [w.id])).rows;
      const soc = (await c.query(`SELECT platform, name, status FROM social_accounts WHERE "workspaceId" = $1 ORDER BY platform, name`, [w.id])).rows;
      console.log(`\n[${w.org}] ${w.name}  -> this login: ${roles.get(w.id) || 'NOT A MEMBER'}`);
      console.log(`  Connected : ${ints.map((i) => `${i.provider}${i.status === 'CONNECTED' ? '' : ` (${i.status})`}`).join(', ') || 'nothing'}`);
      console.log(`  Social    : ${soc.map((s) => `${s.platform}: ${s.name}${s.status === 'ACTIVE' ? '' : ` (${s.status})`}`).join(' | ') || 'none'}`);
    }
  } finally { await c.end(); }
})().catch((e) => { console.log(`Green Start check failed: ${String(e.message).split('\n')[0]}`); process.exit(2); });
JS
'@
$script = $script.Replace('__EMAIL__', $Email.ToLower()).Replace("`r", '') + "`n# end"
$script | ssh $VpsHost 'bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check failed (see the lines above).' }
