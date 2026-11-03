# ---------------------------------------------------------------------------
# WHATSAPP REPLIES INTO OMNI-CHANNEL ON THE LIVE SITE. 2026-11-03. Run it ONCE, AFTER the TeamLink deploy that brings this change.
#
#   .\link-whatsapp-replies-omni-on-vps.ps1
#
# Meta sends the company numbers' replies (and delivered / read ticks) to ONE address: TeamLink's /api/webhooks/whatsapp. TeamLink
# now hands each call on to Omni-Channel (Green Start) on the server itself (utils/greenStartWaForward.js), so replies show in
# Omni-Channel > Channels > WhatsApp. Green Start checks the call with ITS META_APP_SECRET, so TeamLink needs the same value:
#   1. reads META_APP_SECRET from /opt/green-start/gs-api/.env; if Green Start has none, gives it TeamLink's WhatsApp app secret
#      (the Meta app that really signs these calls) and restarts Green Start;
#   2. puts the same value into /opt/teamlink-enterprise/backend/.env as GREENSTART_META_APP_SECRET (TeamLink restarts);
#   3. sends Green Start one EMPTY test call (no message, nothing stored) and prints its answer: 200 = linked.
# Never prints a secret. Changes nothing else. Meta's webhook setting is not touched.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
GS=/opt/green-start/gs-api/.env; TL=/opt/teamlink-enterprise/backend/.env
[ -f "$GS" ] || { echo "Green Start is not installed at /opt/green-start (no $GS)."; exit 1; }
[ -f "$TL" ] || { echo "TeamLink is not at /opt/teamlink-enterprise (no $TL)."; exit 1; }
[ -f /opt/teamlink-enterprise/backend/src/utils/greenStartWaForward.js ] || { echo "The live TeamLink does not have this change yet: wait for the deploy (or run .\deploy-local-to-vps.ps1) first."; exit 1; }
val() { grep -E "^$1=" "$2" | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
cd /opt/teamlink-enterprise/backend
S=$(val META_APP_SECRET "$GS" || true)
if [ ${#S} -lt 16 ]; then
  S=$(node -e 'require("dotenv").config(); require("./src/utils/waNumbers").allAppSecrets().then((a) => { process.stdout.write(a[0] || ""); return require("./src/db").$disconnect(); }).catch(() => process.exit(1));')
  [ ${#S} -ge 16 ] || { echo "Neither Green Start nor TeamLink has a Meta app secret. Save the App secret in TeamLink > Administration > Integrations > WhatsApp first."; exit 1; }
  cp -p "$GS" "$GS.before-wa-link-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^META_APP_SECRET=/d' "$GS"; printf 'META_APP_SECRET=%s\n' "$S" >> "$GS"
  systemctl restart green-start-api
  echo "== Green Start had no META_APP_SECRET: it now has TeamLink's WhatsApp app secret (not shown) and restarted."
else
  echo "== Green Start's META_APP_SECRET is set (${#S} characters, not shown)."
fi
OLD=$(val GREENSTART_META_APP_SECRET "$TL" || true)
if [ "$OLD" = "$S" ]; then
  echo "== TeamLink already has the same value: nothing to change."
else
  cp -p "$TL" "$TL.before-wa-link-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^GREENSTART_META_APP_SECRET=/d' "$TL"; printf 'GREENSTART_META_APP_SECRET=%s\n' "$S" >> "$TL"
  pm2 restart teamlink-enterprise --update-env > /dev/null
  echo "== TeamLink has it now (backend/.env) and restarted."
fi
for i in $(seq 1 40); do curl -fsS -m 3 http://127.0.0.1:4010/api/health > /dev/null 2>&1 && break; sleep 2; done
for i in $(seq 1 40); do curl -fsS -m 3 http://127.0.0.1:4020/api/v1/health > /dev/null 2>&1 && break; sleep 2; done
echo "== an EMPTY test call to Omni-Channel (no message)"
node -e '
require("dotenv").config();
require("./src/utils/greenStartWaForward").forward(JSON.stringify({ object: "whatsapp_business_account", entry: [] })).then((r) => {
  console.log("   " + (r.ok ? "LINKED: Omni-Channel took it (" + r.status + "). WhatsApp replies now reach Channels > WhatsApp." : "NOT linked: " + (r.error || r.status)));
  return require("./src/db").$disconnect();
}).catch((e) => { console.log("   failed: " + String(e.message).slice(0, 200)); process.exit(1); });
'
'@

$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The link script stopped (see the lines above).' }
