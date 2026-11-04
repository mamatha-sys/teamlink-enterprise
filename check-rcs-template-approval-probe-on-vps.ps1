# ---------------------------------------------------------------------------
# CAN WE SEE AN rcssms.in TEMPLATE APPROVAL WITHOUT THEIR WEBHOOK? - one test, 2026-11-04.
#
#   .\check-rcs-template-approval-probe-on-vps.ps1
#
# rcssms.in has no "template status" API, and its approval webhook is not set up for the account yet. This asks the SEND API
# for each template with a mobile number that cannot exist (5 digits), so NO message can go out:
#   - the approved template 22SVkoeCBF (the known good one), and
#   - every template TeamLink / Omni-Channel still shows as "Waiting for approval".
# If rcssms.in answers "wrong number" (024) for the approved one but "template not found" (018 / 031) for the waiting ones,
# the answer tells approved from waiting, and TeamLink can check by itself every few minutes. Paste the WHOLE output to Claude.
# The login is never printed. Changes nothing.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
cd /opt/teamlink-enterprise/backend
node - <<"EOF_NODE"
const env = require("dotenv").parse(require("fs").readFileSync(".env", "utf8"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const base = String(env.RCS_BASE_URL || "https://web.rcssms.in").replace(/\/+$/, "");
const apitype = /^\d{1,2}$/.test(String(env.RCS_SEND_APITYPE || "")) ? env.RCS_SEND_APITYPE : "1";
const hide = (t) => { let s = String(t); for (const v of [env.RCS_PASSWORD, env.RCS_USERNAME]) if (v && v.length >= 3) s = s.split(v).join("***"); return s.replace(/\s+/g, " ").slice(0, 220); };
(async () => {
  const waiting = (await prisma.rcsTemplate.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 8 })).map((t) => ({ id: t.templateId, name: t.name, type: t.rcsType }));
  const list = [{ id: "22SVkoeCBF", name: "TPM (approved, the known good one)", type: "RICH" }, ...waiting];
  console.log(`== asking rcssms.in about ${list.length} template(s) with the impossible number 91234 (nothing can be sent)`);
  for (const t of list) {
    const body = { username: env.RCS_USERNAME, password: env.RCS_PASSWORD, rcstype: t.type || "RICH", rcsid: env.RCS_ID, msisdn: "91234", variables: [{}], templateid: t.id };
    try {
      const r = await fetch(`${base}/rcsapi/jsonapi.jsp?apitype=${apitype}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const txt = await r.text();
      const code = (/ErrorCode"?\s*:\s*"?0*(\d+)/i.exec(txt) || [])[1] || "-";
      console.log(`  ${t.id} | ${t.name} | error ${code} | ${hide(txt)}`);
      if (/msgid/i.test(txt)) console.log("    !! rcssms.in ACCEPTED the impossible number: stop here and tell Claude (no more probes are sent).");
      if (/msgid/i.test(txt)) break;
    } catch (e) { console.log(`  ${t.id} | could not reach rcssms.in: ${hide(e.message)}`); }
  }
  await prisma.$disconnect();
})().catch((e) => { console.log("  failed: " + hide(e.message)); process.exit(0); });
EOF_NODE
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check could not run (see the lines above).' }
