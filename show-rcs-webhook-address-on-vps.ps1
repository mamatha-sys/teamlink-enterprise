# ---------------------------------------------------------------------------
# SHOW THE RCS REPORT ADDRESS to give rcssms.in (template approvals + delivery reports). READ-ONLY. 2026-11-04.
#
#   .\show-rcs-webhook-address-on-vps.ps1
#
# rcssms.in tells us a template is approved (and a message delivered) ONLY by calling this address. Until they set it for the
# account, TeamLink and Omni-Channel keep every new template at "Waiting for approval" even after rcssms.in approved it.
# The address carries a secret token: it is shown here, on YOUR screen only. Give it to rcssms.in support (or paste it in
# their panel's callback / DLR URL setting). Do not post it anywhere else. Nothing is changed on the server.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
cd /opt/teamlink-enterprise/backend
node -e '
const env = require("dotenv").parse(require("fs").readFileSync(".env", "utf8"));
const t = String(env.RCS_WEBHOOK_SECRET || "").trim();
if (!t) { console.log("RCS_WEBHOOK_SECRET is NOT set in backend/.env: run .\\set-rcs-credentials-on-vps.ps1 first."); process.exit(0); }
console.log("");
console.log("Give rcssms.in this address (callback / DLR URL, for template approvals AND delivery reports):");
console.log("");
console.log("  https://teamlink.teamlinks.in/api/webhooks/rcs?token=" + encodeURIComponent(t));
console.log("");
console.log("It works with POST and GET. TeamLink passes every approval on to Omni-Channel by itself.");
'
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the address (see the lines above).' }
