# ---------------------------------------------------------------------------
# LMS: REMOVE THE DEMO COURSES ON THE LIVE SITE (founder 2026-11-02: "LMS module lo demo data remove chey vps lo").
#
#   .\push-lms-demo-removal-to-vps.ps1
#
# 1. Shows (dry run, nothing written) every course on the live site: the DEMO ones that will go (New Hire Orientation, POSH Awareness,
#    Recruitment Fundamentals, Client Communication Standards, "Chain Test Course ...", ZZTEST), demo-named ones that have real
#    content (KEPT), and the real courses (not touched).
# 2. Asks you to type YES, then removes the demo courses with their assignments and attempts. A backup of the whole database is
#    written first (~/.teamlink-backups on the server).
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$VpsRoot = '/opt/teamlink-enterprise'
Write-Host "`n=== Dry run: what would change (nothing is written) ===" -ForegroundColor Cyan
ssh $VpsHost "cd $VpsRoot/backend && node scripts/lms-remove-demo.js"
if ($LASTEXITCODE -ne 0) { throw 'The dry run failed (see the lines above). Is the latest code deployed? (scripts/lms-remove-demo.js)' }
$ok = Read-Host "`nType YES to remove the DEMO courses listed above from the live site (anything else = stop)"
if ($ok -ne 'YES') { Write-Host 'Stopped. Nothing was changed.' -ForegroundColor Yellow; exit 0 }
ssh $VpsHost "cd $VpsRoot/backend && node scripts/lms-remove-demo.js --apply --really-real"
if ($LASTEXITCODE -ne 0) { throw 'The removal failed (see the lines above).' }
Write-Host "`nDONE. The LMS on the live site has only real courses now." -ForegroundColor Green
