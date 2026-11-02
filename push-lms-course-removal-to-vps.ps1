# ---------------------------------------------------------------------------
# LMS ON THE LIVE SITE: REMOVE CHOSEN COURSES (founder 2026-11-02: "remove the course of the R&D training and Manufacturing document only
# one - there are duplicates, so one Manufacturing, the other one not remove").
#
#   .\push-lms-course-removal-to-vps.ps1
#
# 1. Lists every live course with a number. ">>" marks the suggestion: every "R&D ... training" course, and of two courses with the
#    same title the one with fewer people assigned (the other one stays).
# 2. You type the numbers to remove (Enter = the suggestion), it shows those exact titles once more, and you type YES.
# A backup of the whole database is written on the server first. The course's materials, questions, assignments and attempts go too.
# Needs the latest code on the server (scripts/lms-remove-courses.js).
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$VpsRoot = '/opt/teamlink-enterprise'
Write-Host "`n=== Live courses (nothing is changed) ===" -ForegroundColor Cyan
$list = ssh $VpsHost "cd $VpsRoot/backend && node scripts/lms-remove-courses.js"
if ($LASTEXITCODE -ne 0) { $list; throw 'Could not list the courses. Is the latest code deployed? (scripts/lms-remove-courses.js)' }
$list | ForEach-Object { Write-Host $_ }
$suggested = (($list | Where-Object { $_ -like 'SUGGESTED to remove*' }) -replace '^SUGGESTED to remove \(>>\): ', '').Trim()
$pick = Read-Host "`nNumbers to remove, with commas (Enter = the suggestion: $suggested)"
if (-not $pick.Trim()) { $pick = $suggested }
if (-not $pick -or $pick -eq 'none') { Write-Host 'Nothing chosen. Nothing was changed.' -ForegroundColor Yellow; exit 0 }
$pick = ($pick -replace '[^0-9,]', '')
Write-Host "`n=== These would be removed (nothing is changed yet) ===" -ForegroundColor Cyan
ssh $VpsHost "cd $VpsRoot/backend && node scripts/lms-remove-courses.js --remove $pick" | Where-Object { $_ -match '^TO REMOVE|^  "|DRY RUN|REFUSED' }
if ($LASTEXITCODE -ne 0) { throw 'Those numbers were refused (see above).' }
$ok = Read-Host "`nType YES to remove exactly these courses from the live site (anything else = stop)"
if ($ok.Trim() -ne 'YES') { Write-Host 'Stopped. Nothing was changed.' -ForegroundColor Yellow; exit 0 }
ssh $VpsHost "cd $VpsRoot/backend && node scripts/lms-remove-courses.js --remove $pick --apply --really-real" | Select-Object -Last 8
if ($LASTEXITCODE -ne 0) { throw 'The removal failed (see the lines above).' }
Write-Host "`nDONE." -ForegroundColor Green
