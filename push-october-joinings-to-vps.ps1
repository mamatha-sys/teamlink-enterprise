# ---------------------------------------------------------------------------
# OCTOBER JOININGS = THE FOUNDER'S SHEETS (2026-11-09): Keerthana (Medical) 12, Education (Usha Edu 1-5 + Sirisha Edu 6-10) 9.
#
#   .\push-october-joinings-to-vps.ps1                                 DRY RUN on the VPS: what each step would do (nothing changes)
#   .\push-october-joinings-to-vps.ps1 -Pair REQ-0251 -CountSai -Apply  does it (every step backs up the live database first, on the VPS)
#
#   -Pair <code>   the ONE Medical pair that is the same doctor (REQ-0251 Ravi teja, REQ-0252 Vijay Kumar, REQ-0539 Divya): it is merged,
#                  the profile with the joining date kept (undo for 7 days in Candidates > Duplicates > Merges). Without it nothing merges.
#   -CountSai      Sai Chakradhar (Holy Mary, joined 5 Oct, sheet says Drop) counts as a joining: back to Joined on 5 Oct.
#   -Dir <folder>  the joinings workbooks (default Downloads\joinings-2026-11-09): the 27 Oct Education workbook plus row 125 of the
#                  new Education sheet (M Sahin Hoque, joined 23 Oct), and the Medical / Manufacturing workbooks as imported then.
#
# On the VPS:
#   1  scripts/import-joinings-2026-10-17.js --only joinings   rows already imported are skipped; only M Sahin Hoque comes in
#   2  scripts/merge-october-medical-duplicates.js            the -Pair duplicate merged
#   3  scripts/mark-dropped-as-joined.js                      with -CountSai only
# Never runs sync-joinings-list-to-sheets.js (that would move today's joinings that are not in the old sheets back to Selected).
# Deploy first. Do not click inside this window while it runs.
# ---------------------------------------------------------------------------
param(
  [switch]$Apply,
  [ValidateSet('', 'REQ-0251', 'REQ-0252', 'REQ-0539')][string]$Pair = '',
  [switch]$CountSai,
  [string]$Dir = (Join-Path $env:USERPROFILE 'Downloads\joinings-2026-11-09')
)
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$VpsRoot = '/opt/teamlink-enterprise'
$Remote = '/root/joinings-2026-11-09'
$files = @('Education-Team Joinings-2022-2025.xlsx', '_Medical Team Joinings Sheet .xlsx', 'Manufacturing-Joing sheet (1).xlsx')
foreach ($f in $files) { if (-not (Test-Path (Join-Path $Dir $f))) { throw "The workbook is not here: $(Join-Path $Dir $f)" } }

$real = if ($Apply) { 'TL_ALLOW_REAL_APPLY=1 ' } else { '' }
$go = if ($Apply) { ' --apply --really-real' } else { '' }
$word = if ($Apply) { '' } else { ' (dry run)' }

Write-Host "[1/4] Uploading the workbooks..." -ForegroundColor Cyan
ssh $VpsHost "mkdir -p $Remote"
foreach ($f in $files) {
  scp (Join-Path $Dir $f) "${VpsHost}:'$Remote/$f'"
  if ($LASTEXITCODE -ne 0) { throw "Upload failed ($f)." }
}

Write-Host "[2/4] Education: M Sahin Hoque from the sheet$word..." -ForegroundColor Cyan
ssh $VpsHost "cd $VpsRoot/backend && ${real}node scripts/import-joinings-2026-10-17.js --only joinings --downloads $Remote --out /root/teamlink-backups/import-joinings-2026-11-09$go 2>&1 | grep -E 'ALREADY_IMPORTED|CREATED|ENRICHED|SKIPPED|NEEDS_DECISION|APPLIED|DRY RUN|REFUSED|Error'; cat /root/teamlink-backups/import-joinings-2026-11-09/02-reconciliation-every-row.csv | grep -v -E 'ALREADY_IMPORTED|NEEDS_DECISION' | cut -d, -f2-4,6"
if ($LASTEXITCODE -ne 0) { throw 'Step 2 failed (see the lines above).' }

Write-Host "[3/4] Medical: the duplicate doctor$word..." -ForegroundColor Cyan
if ($Apply -and -not $Pair) {
  Write-Host '   skipped: no -Pair given, so nothing is merged' -ForegroundColor Yellow
} else {
  $pairArg = if ($Pair) { " --pair $Pair" } else { '' }
  ssh $VpsHost "cd $VpsRoot/backend && ${real}node scripts/merge-october-medical-duplicates.js$pairArg$go"
  if ($LASTEXITCODE -ne 0) { throw 'Step 3 failed (see the lines above).' }
}

Write-Host "[4/4] Education: Sai Chakradhar counted as joined$word..." -ForegroundColor Cyan
if ($Apply -and -not $CountSai) {
  Write-Host '   skipped: no -CountSai given' -ForegroundColor Yellow
} else {
  ssh $VpsHost "cd $VpsRoot/backend && ${real}node scripts/mark-dropped-as-joined.js --req REQ-0349 --name 'Sai Chakradhar' --day 2026-10-05$go"
  if ($LASTEXITCODE -ne 0) { throw 'Step 4 failed (see the lines above).' }
}

if ($Apply) { Write-Host "`nDone. Open the ATS dashboard -> Joined last month: Keerthana 12, Education 9." -ForegroundColor Green }
else { Write-Host "`nDRY RUN finished. If it looks right, run:  .\push-october-joinings-to-vps.ps1 -Pair <code> -CountSai -Apply" -ForegroundColor Yellow }
