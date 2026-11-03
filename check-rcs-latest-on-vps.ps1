# ---------------------------------------------------------------------------
# "Test send says SENT but no RCS came" + "a new template shows APPROVED at once" - READ-ONLY check of the live server. 2026-11-03.
#
#   .\check-rcs-latest-on-vps.ps1
#
# Changes nothing, sends nothing, never prints the RCS login. It shows:
#   1. the last 8 RCS templates in TeamLink: name, rcssms.in id, type, status, where it was made, when made / last changed;
#   2. the last 10 RCS template audit rows: what TeamLink did and the status rcssms.in gave at that moment;
#   3. the last 10 RCS messages: number (last 4 digits only), template id, the type sent (BASIC / RICH), its variables, status, whether rcssms.in gave a message id, its error,
#      delivered time and the SMS fallback;
#   4. whether rcssms.in has called our report addresses (TeamLink and Omni-Channel; nginx log, the secret hidden):
#      no calls = rcssms.in never sends us delivery reports or template verdicts, so "Sent" can never become "Delivered".
#   5-7. (3 Nov) the same for Omni-Channel (Green Start, its own database): its RCS templates with their TYPE (basic / rich /
#      plain = never on rcssms.in), its RCS messages (Communication "Send now") and its last RCS actions and errors.
#   5. each Omni-Channel workspace's rcssms.in connection: same username / password / bot id as TeamLink's working login? (yes/no only)
#   5b. each workspace's RCS templates (is "tpm" in every workspace?)
#   8. TeamLink's login on the rcssms.in TEMPLATE API, with a request that cannot make a template (no message, no credit);
#   8b. the same with a deliberately wrong password: shows whether rcssms.in checks the login before the type (one refused login).
#   Every list is newest first and short: paste the WHOLE output.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
cd /opt/teamlink-enterprise/backend
node - <<"EOF_NODE"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const t = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");
const parse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };
(async () => {
  console.log("== 1. TeamLink: last 5 RCS templates (newest first)");
  for (const r of await prisma.rcsTemplate.findMany({ orderBy: { updatedAt: "desc" }, take: 5 })) {
    const b = parse(r.bodyJson);
    console.log(`  ${r.name} | id ${r.templateId} | ${r.rcsType} | ${r.status} | made in: ${b.source || "-"} | made ${t(r.createdAt)} | changed ${t(r.updatedAt)}`);
  }
  console.log("== 2. TeamLink: last 5 RCS template audit rows (newest first)");
  for (const a of await prisma.auditLog.findMany({ where: { entity: "RcsTemplate" }, orderBy: { createdAt: "desc" }, take: 5 })) {
    console.log(`  ${t(a.createdAt)} | ${a.action} | ${String(a.toValue || "").slice(0, 160)}`);
  }
  console.log("== 3. TeamLink: last 5 RCS messages (newest first)");
  for (const m of await prisma.rcsMessageLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 })) {
    console.log(`  ${t(m.createdAt)} | ...${String(m.msisdn).slice(-4)} | tpl ${m.templateId} | type ${m.rcsType || "-"} | variables ${m.variablesJson ? m.variablesJson.replace(/\d{6,}/g, "...").slice(0, 80) : "none"} | ${m.status} | msgid ${m.msgId ? "yes" : "NO"} | error ${m.errorCode || "-"} ${String(m.errorText || "").slice(0, 120)} | delivered ${t(m.deliveredAt)} | SMS fallback ${m.fallbackStatus || "-"}${m.fallbackError ? " (" + String(m.fallbackError).slice(0, 80) + ")" : ""}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.log("  could not read the database: " + String(e.message).slice(0, 200)); process.exit(0); });
EOF_NODE
echo "== 4. delivery reports from rcssms.in (nginx logs): TeamLink /api/webhooks/rcs and Omni-Channel /webhooks/smstake-rcs"
LOGS=$(ls /var/log/nginx/access.log* 2>/dev/null || true)
if [ -z "$LOGS" ]; then echo "  no nginx access log found"; else
  for P in "/api/webhooks/rcs" "/webhooks/smstake-rcs"; do
    N=$(zcat -f $LOGS 2>/dev/null | grep -c "$P" || true)
    echo "  $P calls found: $N"
    zcat -f $LOGS 2>/dev/null | grep "$P" | sed -E 's/token=[^ &"]+/token=***/g; s#smstake-rcs/[^ ?"]+#smstake-rcs/***#g' | awk '{print "    " $4 " " $6 " " $7 " -> " $9}' | sort | tail -3 || true
  done
fi
if [ -d /opt/green-start/gs-api ]; then
cd /opt/green-start/gs-api
node - <<"EOF_GS"
// Omni-Channel (Green Start): its OWN database, read only. Numbers: last 4 digits only. No login, token or message text.
const fs = require("fs");
const m = /^DATABASE_URL="?([^"\s]+)"?/m.exec(fs.readFileSync(".env", "utf8"));
const { Client } = require("pg");
const t = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");
const mask = (s) => String(s == null ? "" : s).replace(/\d{6,}/g, "...").replace(/\s+/g, " ");
(async () => {
  if (!m) { console.log("== 5-7. Omni-Channel: DATABASE_URL not found in gs-api/.env"); return; }
  const c = new Client({ connectionString: m[1] }); await c.connect();
  // TeamLink's working rcssms.in login, compared (yes / no only) with what each workspace holds. Values are never printed.
  const tlEnv = require("/opt/teamlink-enterprise/backend/node_modules/dotenv").parse(fs.readFileSync("/opt/teamlink-enterprise/backend/.env", "utf8"));
  const gsKey = (/^ENCRYPTION_KEY="?([^"\s]+)"?/m.exec(fs.readFileSync(".env", "utf8")) || [])[1];
  let decrypt = null;
  for (const p of ["./dist/common/lib/crypto.util.js", "./dist/src/common/lib/crypto.util.js"]) { try { decrypt = require(p).decryptSecret; break; } catch { /* next */ } }
  const tlMode = String(tlEnv.RCS_AUTH_MODE || "password").trim().toLowerCase() === "token" ? "api_key" : "login";
  const tlSecret = tlMode === "api_key" ? tlEnv.RCS_CLIENT_SECRET : tlEnv.RCS_PASSWORD;
  const yn = (b) => (b ? "yes" : "NO");
  console.log(`== 5. Omni-Channel: the rcssms.in connection of each workspace, compared with TeamLink's working login (TeamLink uses ${tlMode})`);
  const wsAll = (await c.query(`select id, name from workspaces order by "createdAt"`)).rows;
  for (const w of wsAll) {
    const rows = (await c.query(`select provider, status, "displayName" as dn, metadata, "accessTokenEnc" as enc, "lastError" as err, "updatedAt" as at from integrations where "workspaceId" = $1 and provider in ('smstake_rcs', 'rcssms_in', 'google_rbm')`, [w.id])).rows;
    if (!rows.length) { console.log(`  ${w.name}: NO RCS connection`); continue; }
    for (const r of rows) {
      const md = r.metadata || {};
      let same = "?";
      if (r.enc && decrypt && gsKey) { try { same = yn(decrypt(r.enc, gsKey) === tlSecret); } catch { same = "cannot read"; } }
      console.log(`  ${w.name}: ${r.provider} | ${r.status} | ${r.dn || "-"} | login mode ${md.authMode || "-"} | same username ${yn(md.username === tlEnv.RCS_USERNAME)} | same password/secret ${same} | same bot id ${yn(String(md.rcsId || "") === String(tlEnv.RCS_ID || ""))} | changed ${t(r.at)}${r.err ? " | last error " + mask(r.err).slice(0, 120) : ""}`);
    }
  }
  console.log("== 5b. Omni-Channel: the RCS templates of each workspace");
  for (const w of wsAll) {
    const rows = (await c.query(`select t.name, t.status, t."providerTemplateId" as pid, t.meta->'rcsCarrier'->'shape'->>'kind' as kind, t.meta->'rcsCarrierDraft'->'failure'->>'message' as fail
        from templates t where t."workspaceId" = $1 and t.channel = 'rcs' order by t."updatedAt" desc limit 12`, [w.id])).rows;
    console.log(`  ${w.name}: ${rows.length ? rows.map((r) => `${r.name} (${r.status}, ${r.pid ? "SMSTAKE id " + r.pid : "no SMSTAKE id"}, ${r.kind || "plain"}${r.fail ? ", not submitted" : ""})`).join("; ") : "none"}`);
  }
  console.log("== 6. Omni-Channel: last 6 RCS messages (newest first)");
  for (const r of (await c.query(`select m."createdAt" as at, w.name as ws, m.provider, m.status, m."providerMessageId" is not null as mid, m."errorReason" as err, m.content->>'to' as to, t.name as tpl, t.meta->'rcsCarrier'->'shape'->>'kind' as kind, t."providerTemplateId" as pid
      from messages m join workspaces w on w.id = m."workspaceId" left join templates t on t.id = m."templateId" where m.channel = 'rcs' order by m."createdAt" desc limit 6`)).rows) {
    console.log(`  ${t(r.at)} | ${r.ws} | ...${String(r.to || "").replace(/\D/g, "").slice(-4) || "?"} | tpl ${r.tpl || "-"} (${r.pid || "no SMSTAKE id"}, type ${r.kind || "plain"}) | via ${r.provider || "-"} | ${r.status} | msgid ${r.mid ? "yes" : "NO"}${r.err ? " | error " + mask(r.err).slice(0, 140) : ""}`);
  }
  console.log("== 7. Omni-Channel: last 8 RCS actions and errors (newest first)");
  for (const r of (await c.query(`select a."createdAt" as at, a.action, a.success, a.summary from audit_logs a
      where (a.summary ilike '%RCS%' or a.action ilike '%rcs%') order by a."createdAt" desc limit 8`)).rows) {
    console.log(`  ${t(r.at)} | ${r.action} | ${r.success ? "ok" : "FAILED"} | ${mask(r.summary).slice(0, 180)}`);
  }
  await c.end();
  console.log("== 8. TeamLink's login on the rcssms.in TEMPLATE API (type ZZCHECK, no text: no template can be made, nothing is sent)");
  try {
    const base = String(tlEnv.RCS_BASE_URL || "https://web.rcssms.in").replace(/\/+$/, "");
    const body = { username: tlEnv.RCS_USERNAME, password: tlEnv.RCS_PASSWORD, rcstype: "ZZCHECK", rcsid: tlEnv.RCS_ID, cname: "zz_login_check", description: "" };
    const r = await fetch(`${base}/rcsapi/rcscreatetemplate.jsp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    let txt = await r.text();
    for (const s of [tlEnv.RCS_PASSWORD, tlEnv.RCS_USERNAME]) if (s && s.length >= 3) txt = txt.split(s).join("***");
    console.log(`  rcssms.in answered: HTTP ${r.status} ${mask(txt).slice(0, 200)}`);
    const code = (/ErrorCode"?\s*:\s*"?0*(\d+)/i.exec(txt) || [])[1];
    if (/templateid/i.test(txt)) console.log("  => it MADE a template (zz_login_check): delete it in the rcssms.in panel. The login works on the template API.");
    else if (code === "22") console.log("  => the TEMPLATE API refuses this login (sending accepts it): ask rcssms.in to switch on template creation by API for this account.");
    else if (code === "21") console.log("  => the TEMPLATE API does not know this username: ask rcssms.in.");
    else if (code === "10" && !(tlEnv.RCS_USERNAME && tlEnv.RCS_PASSWORD && tlEnv.RCS_ID)) console.log("  => TeamLink's RCS login is not complete in backend/.env (username, password or RCS id missing).");
    else console.log(`  => not refused for the login (error ${code || "none"} is about the deliberately wrong type). See 8b: does rcssms.in check the login first?`);
    console.log("== 8b. the same wrong request with a deliberately WRONG password (nothing can be made; shows whether rcssms.in checks the login before the type)");
    const r2 = await fetch(`${base}/rcsapi/rcscreatetemplate.jsp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, password: "zz-wrong-password-check" }), signal: AbortSignal.timeout(20000) });
    let txt2 = await r2.text();
    for (const s of [tlEnv.RCS_PASSWORD, tlEnv.RCS_USERNAME]) if (s && s.length >= 3) txt2 = txt2.split(s).join("***");
    console.log(`  rcssms.in answered: HTTP ${r2.status} ${mask(txt2).slice(0, 200)}`);
    const code2 = (/ErrorCode"?\s*:\s*"?0*(\d+)/i.exec(txt2) || [])[1];
    if (code2 === "22" && code !== "22") console.log("  => rcssms.in checks the LOGIN FIRST, and TeamLink's real login PASSED on the template API (8). So the 022 in Omni-Channel comes from Omni-Channel's own request: send these lines to Claude.");
    else if (code2 === code) console.log("  => rcssms.in checks the TYPE before the login, so 8 does not prove the login works on the template API. Send these lines to Claude.");
    else console.log("  => another answer: send these lines to Claude.");
  } catch (e) { console.log("  could not reach rcssms.in: " + mask(e.message).slice(0, 150)); }
})().catch((e) => console.log("  could not read the Omni-Channel database: " + mask(e.message).slice(0, 200)));
EOF_GS
fi
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check could not run (see the lines above).' }
