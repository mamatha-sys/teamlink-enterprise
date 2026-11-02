# ---------------------------------------------------------------------------
# LIVE SITE: WORD / EXCEL / POWERPOINT OPEN INSIDE THE LMS (founder 2026-11-02: "word, pdf anni document format upload cheyochu").
# TeamLink turns an Office file into a PDF with LibreOffice (backend/src/utils/officeToPdf.js) and shows that PDF in the in-app viewer -
# never a download. This installs LibreOffice (writer, calc, impress, no desktop extras) and common fonts on the server.
#
#   .\install-office-converter-on-vps.ps1     shows whether it is there (changes nothing), then asks YES
# About 300-400 MB of disk. TeamLink notices it within 5 minutes by itself (no restart); Office files already in courses are turned
# into PDF the first time somebody opens them.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
Write-Host "[1/2] Is LibreOffice on the live server? (nothing changes)" -ForegroundColor Cyan
ssh $VpsHost 'if command -v soffice >/dev/null 2>&1; then echo "INSTALLED: $(soffice --version 2>/dev/null | head -1)"; else echo "NOT INSTALLED"; fi; echo "free disk: $(df -h / | awk ''NR==2{print $4}'')"'
if ($LASTEXITCODE -ne 0) { throw 'Could not reach the server.' }
$ok = Read-Host "`nType YES to install LibreOffice (writer, calc, impress) and fonts on the live server"
if ($ok.Trim() -ne 'YES') { Write-Host 'Not changed.' -ForegroundColor Yellow; exit 0 }
Write-Host "[2/2] Installing (a few minutes)..." -ForegroundColor Cyan
ssh $VpsHost 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu-core fonts-liberation2 >/dev/null && echo "INSTALLED: $(soffice --version | head -1)"'
if ($LASTEXITCODE -ne 0) { throw 'The install did not finish (see the lines above).' }
Write-Host "`nDONE. In about 5 minutes Word, Excel and PowerPoint files in the LMS open as PDF inside the app." -ForegroundColor Green
