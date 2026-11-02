# ---------------------------------------------------------------------------
# LIVE SITE: LET UPLOADS BIGGER THAN 1 MB THROUGH (2026-11-02). The live nginx answered "413 Request Entity Too Large" to anything over
# about 1 MB, so LMS documents and videos over that were refused. This raises the site's client_max_body_size to 64 MB.
#
#   .\fix-upload-size-on-vps.ps1        shows what the site file has now (changes nothing), then asks YES
# The site file is backed up on the server first; if nginx does not accept the change, the old file is put back.
# (Even without this, the LMS screen now sends big files in small pieces - slower, but it works.)
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$Script = Get-Content -Raw (Join-Path $PSScriptRoot 'deploy\vps\fix-upload-size-nginx.sh')
Write-Host "[1/2] What the live nginx has now (nothing changes)..." -ForegroundColor Cyan
$Script.Replace("`r", "") | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the server (see the lines above).' }
$ok = Read-Host "`nType YES to raise the upload limit to 64 MB"
if ($ok.Trim() -ne 'YES') { Write-Host 'Not changed.' -ForegroundColor Yellow; exit 0 }
Write-Host "[2/2] Changing it (a backup of the site file is kept)..." -ForegroundColor Cyan
$Script.Replace("`r", "") | ssh $VpsHost 'tr -d ''\r'' | bash -s -- --apply'
if ($LASTEXITCODE -ne 0) { throw 'It did not finish (see the lines above).' }
$tmp = New-TemporaryFile
[IO.File]::WriteAllBytes($tmp, (New-Object byte[] (12MB)))
try { $code = (Invoke-WebRequest -Uri 'https://teamlink.teamlinks.in/api/lms/material-uploads/check?offset=0' -Method Put -InFile $tmp -ContentType 'application/octet-stream' -UseBasicParsing -TimeoutSec 120).StatusCode } catch { $code = $_.Exception.Response.StatusCode.value__ }
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($code -eq 401) { Write-Host "`nDONE: a 12 MB upload now reaches TeamLink (it answers 'sign in first', as it should)." -ForegroundColor Green }
else { Write-Host "`nA 12 MB upload still answers $code. Send these lines to Claude." -ForegroundColor Red }
