# ---------------------------------------------------------------------------
# GREEN START COMPANY LOGIN: A REAL EMAIL INSTEAD OF THE DEMO ONE (founder 2026-11-06: "admin greenstartdemo dhi thiseyandi ... maa admin email
# tho chupinchali, akkada emi integrations, features chesamo anni ikkada kanipinchali").
#
#   .\change-greenstart-admin-email-on-vps.ps1 -Email admin@yourcompany.com           (only SHOWS what would change, changes nothing)
#   .\change-greenstart-admin-email-on-vps.ps1 -Email admin@yourcompany.com -Apply    (does it)
#
# The account is RENAMED, not replaced: same user id, so every organisation, workspace, integration, campaign, template and module stays with it.
# Its department logins (<name>+omni-<dept>@<domain>) move to the new address too, because TeamLink works those out from the company email.
# Then TeamLink's "company account" setting and GREENSTART_SSO_EMAIL follow, and one real sign-in checks it.
# It stops, changing nothing, when the new address already has a Green Start account (that needs a decision, not a rename).
# The old addresses are kept in /root/greenstart-admin-email-<time>.txt on the VPS, so it can be put back. Nothing secret is printed.
# ---------------------------------------------------------------------------
param(
  [Parameter(Mandatory = $true)][string]$Email,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if ($Email -notmatch '^[^\s@''"+]+@[^\s@''"]+\.[^\s@''"]+$') { throw "That is not an email address (no + in it, please): $Email" }
if ($Email -match '\.demo$') { throw "Give a real email, not a demo one: $Email" }
$VpsHost = 'root@72.61.233.104'
$script = @'
set -e
TL=/opt/teamlink-enterprise/backend/.env
GS=/opt/green-start/gs-api/.env
[ -f "$TL" ] || { echo "TeamLink .env not found at $TL"; exit 1; }
[ -f "$GS" ] || { echo "Green Start .env not found at $GS"; exit 1; }
export NEW_EMAIL="__EMAIL__" DO_APPLY="__APPLY__" STAMP="$(date +%Y%m%d-%H%M%S)"
CUR=$(cd /opt/teamlink-enterprise/backend && node -e '
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.appSetting.findUnique({ where: { key: "omni.gs.ssoEmail" } })
  .then((r) => console.log(r ? JSON.parse(r.value) : ""))
  .catch(() => console.log(""))
  .finally(() => p.$disconnect());
')
[ -n "$CUR" ] || CUR=$(sed -n 's/^GREENSTART_SSO_EMAIL=//p' "$TL" | tail -1)
[ -n "$CUR" ] || { echo "TeamLink has no company Green Start account yet (Omni-Channel > Manage)."; exit 1; }
export OLD_EMAIL="$CUR"
cd /opt/green-start/gs-api
node - <<'JS'
const fs = require('fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l)) || '';
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '').replace(/\?.*$/, '');
const { Client } = require('pg');
const OLD = process.env.OLD_EMAIL.trim().toLowerCase();
const NEW = process.env.NEW_EMAIL.trim().toLowerCase();
const stop = (words) => { console.log(`STOPPED, nothing changed: ${words}`); process.exit(3); };
const deptAddress = (addr, email) => { const [l, d] = email.split('@'); return `${l}+omni-${addr.slice(addr.indexOf('+omni-') + 6, addr.lastIndexOf('@'))}@${d}`; };
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const me = (await c.query('SELECT id, email, name FROM users WHERE "emailLower" = $1', [OLD])).rows[0];
    if (!me) stop(`Green Start has no account ${OLD}.`);
    console.log(`Company account now : ${me.email}`);
    console.log(`It will become      : ${NEW}`);
    if (OLD === NEW) stop('It already has this email.');
    if ((await c.query('SELECT 1 FROM users WHERE "emailLower" = $1', [NEW])).rows.length) stop(`${NEW} already has its own Green Start account. Tell Claude: the two accounts need a decision.`);
    const orgs = (await c.query('SELECT o.id, o.name FROM organizations o WHERE o."ownerId" = $1', [me.id])).rows;
    console.log(`Organisations owned : ${orgs.map((o) => o.name).join(', ') || 'none'}`);
    const wss = orgs.length ? (await c.query('SELECT name FROM workspaces WHERE "organizationId" = ANY($1::uuid[])', [orgs.map((o) => o.id)])).rows : [];
    console.log(`Workspaces kept     : ${wss.length} (${wss.map((w) => w.name).join(', ')})`);
    const [l, d] = OLD.split('@');
    const depts = (await c.query('SELECT id, email FROM users WHERE "emailLower" LIKE $1', [`${l.split('+')[0]}+omni-%@${d}`])).rows;
    const moves = depts.map((u) => ({ ...u, to: deptAddress(u.email.toLowerCase(), NEW) }));
    moves.forEach((m) => console.log(`Department login    : ${m.email} -> ${m.to}`));
    for (const m of moves) if ((await c.query('SELECT 1 FROM users WHERE "emailLower" = $1', [m.to])).rows.length) stop(`${m.to} already has an account.`);
    if (process.env.DO_APPLY !== 'yes') {
      console.log('\nNothing was changed. If this is right, run it again with -Apply');
      process.exit(4);
    }
    fs.writeFileSync(`/root/greenstart-admin-email-${process.env.STAMP}.txt`, JSON.stringify({ company: { id: me.id, email: me.email }, departments: moves.map((m) => ({ id: m.id, email: m.email })) }, null, 1));
    await c.query('BEGIN');
    await c.query('UPDATE users SET email = $1, "emailLower" = $1 WHERE id = $2', [NEW, me.id]);
    for (const m of moves) await c.query('UPDATE users SET email = $1, "emailLower" = $1 WHERE id = $2', [m.to, m.id]);
    await c.query('COMMIT');
    console.log(`Renamed in Green Start. Old addresses saved in /root/greenstart-admin-email-${process.env.STAMP}.txt`);
  } finally { await c.end(); }
})().catch((e) => { console.log(`STOPPED: ${String(e.message).split('\n')[0]}`); process.exit(2); });
JS
RC=$?
[ "$RC" = 0 ] || exit "$RC"
cd /opt/teamlink-enterprise/backend
node -e '
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const key = "omni.gs.ssoEmail";
const value = JSON.stringify(process.env.NEW_EMAIL.toLowerCase());
p.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }).finally(() => p.$disconnect());
'
sed -i '/^GREENSTART_SSO_EMAIL=/d' "$TL"; printf 'GREENSTART_SSO_EMAIL=%s\n' "$NEW_EMAIL" >> "$TL"
pm2 restart teamlink-enterprise --update-env >/dev/null && echo "TeamLink restarted."
TL_ENV="$TL" GS_ENV="$GS" node - <<'JS'
const fs = require('fs');
const crypto = require('crypto');
const val = (file, key, dflt) => { const l = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((x) => x.startsWith(`${key}=`)); return l ? l.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : dflt; };
const secret = val(process.env.TL_ENV, 'GREENSTART_SSO_SECRET', '');
const port = val(process.env.GS_ENV, 'PORT', '4020');
const prefix = val(process.env.GS_ENV, 'API_PREFIX', 'api');
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = b64({ alg: 'HS256', typ: 'JWT' });
const p = b64({ iss: 'teamlink', aud: 'greenstart', email: process.env.NEW_EMAIL.toLowerCase(), name: 'TeamLink', externalUserId: 'setup-check', iat: now, exp: now + 60, jti: crypto.randomUUID() });
const ticket = `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
fetch(`http://127.0.0.1:${port}/${prefix}/v1/auth/teamlink`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) })
  .then(async (r) => {
    if (r.ok) { console.log(`CHECK OK: Green Start accepted the sign-in for ${process.env.NEW_EMAIL}.`); return; }
    const j = await r.json().catch(() => ({})); const e = j.error || {};
    console.log(`CHECK FAILED (${r.status}): ${e.code || ''} ${e.message || ''}`.trim()); process.exit(2);
  })
  .catch((e) => { console.log(`CHECK FAILED: ${e.message}`); process.exit(2); });
JS
'@
# Same line-ending care as enable-greenstart-sso-on-vps.ps1: end on a comment line, so the "\r" PowerShell adds lands on it.
$script = $script.Replace('__EMAIL__', $Email.ToLower()).Replace('__APPLY__', $(if ($Apply) { 'yes' } else { 'no' })).Replace("`r", '') + "`n# end"
$script | ssh $VpsHost 'bash -s'
$rc = $LASTEXITCODE
if ($rc -eq 4) { exit 0 }  # the preview finished: nothing was changed
if ($rc -ne 0) { throw 'It did not finish on the VPS (see the lines above).' }
Write-Host "`nDone. Open TeamLink -> Omni-Channel: it now opens as $Email, with everything as it was." -ForegroundColor Green
