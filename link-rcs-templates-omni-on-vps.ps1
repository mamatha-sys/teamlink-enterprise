# ---------------------------------------------------------------------------
# RCS TEMPLATES: OMNI-CHANNEL <-> TEAMLINK ON THE LIVE SITE. 2026-10-31. Run it AFTER the TeamLink deploy that brings this change.
#
#   .\link-rcs-templates-omni-on-vps.ps1
#
# rcssms.in sends template approvals and delivery reports to ONE address: TeamLink's /api/webhooks/rcs?token=... (the address
# set-rcs-credentials-on-vps.ps1 shows). Omni-Channel (Green Start) cannot be reached from outside (the TeamLink gate), so TeamLink
# hands each call to Green Start on the server itself. For that, TeamLink needs Green Start's SMSTAKE_RCS_WEBHOOK_SECRET:
#   1. reads it from /opt/green-start/gs-api/.env (if it is not set there, makes a new random one and sets it there; Green Start restarts);
#   2. puts the SAME value into /opt/teamlink-enterprise/backend/.env as GREENSTART_RCS_WEBHOOK_SECRET (TeamLink restarts);
#   3. pulls Omni-Channel's RCS templates into TeamLink once and prints the result line.
# Never prints the secret. Changes nothing else. rcssms.in's settings are not touched.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
GS=/opt/green-start/gs-api/.env; TL=/opt/teamlink-enterprise/backend/.env
[ -f "$GS" ] || { echo "Green Start is not installed at /opt/green-start (no $GS)."; exit 1; }
[ -f "$TL" ] || { echo "TeamLink is not at /opt/teamlink-enterprise (no $TL)."; exit 1; }
grep -q "rcsOmniSync" /opt/teamlink-enterprise/backend/src/routes/rcsWebhook.js || { echo "The live TeamLink does not have this change yet: run .\deploy-local-to-vps.ps1 first."; exit 1; }
val() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
S=$(val SMSTAKE_RCS_WEBHOOK_SECRET "$GS" || true)
if [ ${#S} -lt 16 ]; then
  S=$(openssl rand -hex 24)
  cp -p "$GS" "$GS.before-rcs-link-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^SMSTAKE_RCS_WEBHOOK_SECRET=/d' "$GS"; printf 'SMSTAKE_RCS_WEBHOOK_SECRET=%s\n' "$S" >> "$GS"
  systemctl restart green-start-api
  echo "== Green Start had no RCS webhook secret: a new one is set (not shown) and Green Start restarted."
else
  echo "== Green Start's RCS webhook secret is set (${#S} characters, not shown)."
fi
case "$S" in *[!A-Za-z0-9._~-]*) echo "The Green Start secret has characters that cannot go into an address. Set SMSTAKE_RCS_WEBHOOK_SECRET to letters/digits only, then run again."; exit 1;; esac
OLD=$(val GREENSTART_RCS_WEBHOOK_SECRET "$TL" || true)
if [ "$OLD" = "$S" ]; then
  echo "== TeamLink already has the same secret: nothing to change."
else
  cp -p "$TL" "$TL.before-rcs-link-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^GREENSTART_RCS_WEBHOOK_SECRET=/d' "$TL"; printf 'GREENSTART_RCS_WEBHOOK_SECRET=%s\n' "$S" >> "$TL"
  pm2 restart teamlink-enterprise --update-env > /dev/null
  echo "== TeamLink has the secret now (backend/.env) and restarted."
fi
for i in $(seq 1 40); do curl -fsS -m 3 http://127.0.0.1:4010/api/health > /dev/null 2>&1 && break; sleep 2; done
for i in $(seq 1 40); do curl -fsS -m 3 http://127.0.0.1:4020/api/v1/health > /dev/null 2>&1 && break; sleep 2; done
echo "== taking Omni-Channel's RCS templates into TeamLink once"
cd /opt/teamlink-enterprise/backend
node -e '
require("dotenv").config();
const O = require("./src/utils/rcsOmniSync");
O.pull({ why: "link-script" }).then((r) => { console.log("   " + (r.ok ? "OK: " : "NOT DONE: ") + r.words); return require("./src/db").$disconnect(); }).catch((e) => { console.log("   failed: " + String(e.message).slice(0, 200)); process.exit(1); });
'
echo "Done. Integrations > RCS > Templates shows the Omni-Channel templates (approved ones can be sent) and, after rcssms.in's next call, \"Last rcssms.in answer passed to Omni-Channel\"."
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The link could not be finished (see the lines above).' }
