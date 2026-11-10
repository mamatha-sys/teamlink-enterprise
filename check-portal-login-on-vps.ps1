# ---------------------------------------------------------------------------
# A CANDIDATE GETS "INCORRECT EMAIL OR PASSWORD" ON THE LIVE JOB PORTAL (founder 2026-11-10) - CHECK ONLY.
#
#   .\check-portal-login-on-vps.ps1 -Find keerthigujjula
#
# Runs backend/scripts/portal-login-check.js on the server: the portal account(s) with that text in the email (exact spelling saved,
# active or not, temporary password, last sign-in), the candidate rows and the login messages sent to them. Changes nothing, sends
# nothing, shows no password. Copy the lines back to Claude.
# ---------------------------------------------------------------------------
param([Parameter(Mandatory = $true)][string]$Find)
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$VpsRoot = '/opt/teamlink-enterprise'
$safe = ($Find -replace "[^A-Za-z0-9@._+ -]", '')
ssh $VpsHost "cd $VpsRoot/backend && [ -f scripts/portal-login-check.js ] || { echo 'Not on the server yet: wait 2 minutes for the auto-deploy, then run this again.'; exit 1; }; node scripts/portal-login-check.js '--find=$safe'"
if ($LASTEXITCODE -ne 0) { Write-Host "`nIt did not finish (see the lines above). Copy them to Claude." -ForegroundColor Yellow }
