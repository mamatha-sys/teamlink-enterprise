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
#   4. whether rcssms.in has called our report address (/api/webhooks/rcs) in the last days (nginx log, the ?token= hidden):
#      no calls = rcssms.in never sends us delivery reports or template verdicts, so "Sent" can never become "Delivered".
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
  console.log("== 1. last 8 RCS templates");
  for (const r of await prisma.rcsTemplate.findMany({ orderBy: { updatedAt: "desc" }, take: 8 })) {
    const b = parse(r.bodyJson);
    console.log(`  ${r.name} | id ${r.templateId} | ${r.rcsType} | ${r.status} | made in: ${b.source || "-"} | made ${t(r.createdAt)} | changed ${t(r.updatedAt)}`);
  }
  console.log("== 2. last 10 RCS template audit rows");
  for (const a of await prisma.auditLog.findMany({ where: { entity: "RcsTemplate" }, orderBy: { createdAt: "desc" }, take: 10 })) {
    console.log(`  ${t(a.createdAt)} | ${a.action} | ${String(a.toValue || "").slice(0, 160)}`);
  }
  console.log("== 3. last 10 RCS messages");
  for (const m of await prisma.rcsMessageLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 })) {
    console.log(`  ${t(m.createdAt)} | ...${String(m.msisdn).slice(-4)} | tpl ${m.templateId} | type ${m.rcsType || "-"} | variables ${m.variablesJson ? m.variablesJson.replace(/\d{6,}/g, "...").slice(0, 80) : "none"} | ${m.status} | msgid ${m.msgId ? "yes" : "NO"} | error ${m.errorCode || "-"} ${String(m.errorText || "").slice(0, 120)} | delivered ${t(m.deliveredAt)} | SMS fallback ${m.fallbackStatus || "-"}${m.fallbackError ? " (" + String(m.fallbackError).slice(0, 80) + ")" : ""}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.log("  could not read the database: " + String(e.message).slice(0, 200)); process.exit(0); });
EOF_NODE
echo "== 4. calls from rcssms.in to /api/webhooks/rcs (nginx logs, newest last)"
LOGS=$(ls /var/log/nginx/access.log* 2>/dev/null || true)
if [ -z "$LOGS" ]; then echo "  no nginx access log found"; else
  N=$(zcat -f $LOGS 2>/dev/null | grep -c "/api/webhooks/rcs" || true)
  echo "  calls found: $N"
  zcat -f $LOGS 2>/dev/null | grep "/api/webhooks/rcs" | sed -E 's/token=[^ &"]+/token=***/g' | awk '{print "  " $4 " " $6 " " $7 " -> " $9}' | sort | tail -8 || true
fi
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check could not run (see the lines above).' }
