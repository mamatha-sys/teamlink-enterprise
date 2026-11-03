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
  console.log("== 5. Omni-Channel: last 6 RCS templates (newest first)");
  for (const r of (await c.query(`select t.name, t.provider, t.status, t."providerTemplateId" as pid, t.meta->'rcsCarrier'->'shape'->>'kind' as kind, t.meta->'rcsCarrierDraft'->'failure'->>'message' as fail, w.name as ws, t."updatedAt" as at
      from templates t join workspaces w on w.id = t."workspaceId" where t.channel = 'rcs' order by t."updatedAt" desc limit 6`)).rows) {
    console.log(`  ${r.name} | ${r.ws} | ${r.provider} | ${r.status} | SMSTAKE id ${r.pid || "-"} | type ${r.kind || "plain (not on rcssms.in)"} | changed ${t(r.at)}${r.fail ? " | not submitted: " + mask(r.fail).slice(0, 120) : ""}`);
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
})().catch((e) => console.log("  could not read the Omni-Channel database: " + mask(e.message).slice(0, 200)));
EOF_GS
fi
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check could not run (see the lines above).' }
