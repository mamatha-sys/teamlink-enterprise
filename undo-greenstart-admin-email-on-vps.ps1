# ---------------------------------------------------------------------------
# PUT THE GREEN START COMPANY LOGIN BACK (2026-11-06): the email rename ran with an example address (mee-email@company.com), which is not ours.
#
#   .\undo-greenstart-admin-email-on-vps.ps1
#
# Reads the newest /root/greenstart-admin-email-*.txt the rename saved and gives each account its old address back, by id. Nothing else changes.
# If an employee opened Omni-Channel meanwhile and an empty account got the old department address, that account is moved aside (renamed, not deleted)
# and printed. Then TeamLink's company account setting, GREENSTART_SSO_EMAIL and the stored department logins follow, and one real sign-in checks it.
# Nothing secret is printed.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$script = @'
set -e
TL=/opt/teamlink-enterprise/backend/.env
GS=/opt/green-start/gs-api/.env
F=$(ls -t /root/greenstart-admin-email-*.txt 2>/dev/null | head -1)
[ -n "$F" ] || { echo "No saved addresses found on the server, nothing was changed."; exit 1; }
echo "Using $F"
export SAVED="$F" MAP_FILE="/root/.greenstart-email-map.json" STAMP="$(date +%Y%m%d%H%M%S)"
cd /opt/green-start/gs-api
node - <<'JS'
const fs = require('fs');
const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l)) || '';
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '').replace(/\?.*$/, '');
const { Client } = require('pg');
const saved = JSON.parse(fs.readFileSync(process.env.SAVED, 'utf8'));
const rows = [saved.company, ...saved.departments];
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const map = {};
    await c.query('BEGIN');
    for (const r of rows) {
      const now = (await c.query('SELECT email FROM users WHERE id = $1', [r.id])).rows[0];
      if (!now) throw new Error(`The account of ${r.email} is gone.`);
      const back = r.email.toLowerCase();
      const other = (await c.query('SELECT id, email FROM users WHERE "emailLower" = $1 AND id <> $2', [back, r.id])).rows[0];
      if (other) {
        const [l, d] = back.split('@');
        const aside = `moved-${process.env.STAMP}-${l.replace(/\+/g, '-')}@${d}`;
        await c.query('UPDATE users SET email = $1, "emailLower" = $1 WHERE id = $2', [aside, other.id]);
        console.log(`Moved aside         : ${other.email} -> ${aside} (made while the wrong address was in place)`);
      }
      await c.query('UPDATE users SET email = $1, "emailLower" = $2 WHERE id = $3', [r.email, back, r.id]);
      console.log(`Put back            : ${now.email} -> ${r.email}`);
      map[now.email.toLowerCase()] = back;
    }
    await c.query('COMMIT');
    fs.writeFileSync(process.env.MAP_FILE, JSON.stringify({ company: saved.company.email.toLowerCase(), map }));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await c.end(); }
})().catch((e) => { console.log(`STOPPED, nothing changed: ${String(e.message).split('\n')[0]}`); process.exit(2); });
JS
cd /opt/teamlink-enterprise/backend
node -e '
require("dotenv").config();
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const { company, map } = JSON.parse(fs.readFileSync(process.env.MAP_FILE, "utf8"));
(async () => {
  const key = "omni.gs.ssoEmail";
  const value = JSON.stringify(company);
  await p.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const d = await p.appSetting.findUnique({ where: { key: "omni.gs.deptLogins" } });
  if (d) {
    let v = d.value;
    for (const [from, to] of Object.entries(map)) v = v.split(from).join(to);
    if (v !== d.value) await p.appSetting.update({ where: { key: "omni.gs.deptLogins" }, data: { value: v } });
  }
  console.log("TeamLink settings put back.");
})().catch((e) => { console.log(`TeamLink settings failed: ${String(e.message).split("\n")[0]}`); process.exit(2); }).finally(() => p.$disconnect());
'
export OLD_EMAIL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.MAP_FILE, "utf8")).company)')
rm -f "$MAP_FILE"
sed -i '/^GREENSTART_SSO_EMAIL=/d' "$TL"; printf 'GREENSTART_SSO_EMAIL=%s\n' "$OLD_EMAIL" >> "$TL"
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
const p = b64({ iss: 'teamlink', aud: 'greenstart', email: process.env.OLD_EMAIL, name: 'TeamLink', externalUserId: 'setup-check', iat: now, exp: now + 60, jti: crypto.randomUUID() });
const ticket = `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
fetch(`http://127.0.0.1:${port}/${prefix}/v1/auth/teamlink`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) })
  .then(async (r) => {
    if (r.ok) { console.log(`CHECK OK: Green Start accepted the sign-in for ${process.env.OLD_EMAIL}.`); return; }
    const j = await r.json().catch(() => ({})); const e = j.error || {};
    console.log(`CHECK FAILED (${r.status}): ${e.code || ''} ${e.message || ''}`.trim()); process.exit(2);
  })
  .catch((e) => { console.log(`CHECK FAILED: ${e.message}`); process.exit(2); });
JS
'@
$script = $script.Replace("`r", '') + "`n# end"
$script | ssh $VpsHost 'bash -s'
if ($LASTEXITCODE -ne 0) { throw 'It did not finish on the VPS (see the lines above).' }
Write-Host "`nDone. The company login has its old address again." -ForegroundColor Green
