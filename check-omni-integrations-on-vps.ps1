# ---------------------------------------------------------------------------
# ARE ALL ACCOUNTS AND SOCIAL MEDIA INTEGRATIONS IN OMNI-CHANNEL ON THE LIVE SITE? (founder 2026-11-02)
#
#   .\check-omni-integrations-on-vps.ps1          shows what live TeamLink has connected and what Omni-Channel got (read only)
#   .\check-omni-integrations-on-vps.ps1 -Sync    ... and hands everything to Omni-Channel again now (= "Send to Omni-Channel now")
#
# Run it AFTER .\push-everything-to-vps.ps1 (the script must be on the server). No token, key or password is ever printed.
# Copy the whole output back to Claude.
# ---------------------------------------------------------------------------
param([switch]$Sync)
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$VpsRoot = '/opt/teamlink-enterprise'
$extra = if ($Sync) { ' --sync' } else { '' }
ssh $VpsHost "cd $VpsRoot/backend && node scripts/omni-integrations-status.js$extra"
if ($LASTEXITCODE -ne 0) { throw 'The check failed (see the lines above).' }
