# ---------------------------------------------------------------------------
# WHY IS THE LIVE SITE NOT UPDATING? (2026-11-03: the LMS crash fix pushed at 17:47 on 2 Nov was not live the next morning - the live
# site still ran a build from about 17:00.) The VPS deploys GitHub main by itself every 2 minutes (deploy/vps/teamlink-sync.sh).
#
#   .\check-live-deploy-on-vps.ps1
# 1. Shows (nothing changes) the auto-deploy's STATUS, any ALERT, whether it is PAUSED, and its last 30 log lines.
# 2. Asks YES to run that same deploy now (GitHub main -> live: build, database migrations, restart). Databases, .env files and
#    uploads are never touched by it. Send the lines it prints to Claude if it stops.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$Look = @'
S=/opt/teamlink-sync
echo "STATUS : $(cat $S/STATUS 2>/dev/null || echo 'none')"
[ -f $S/ALERT ] && echo "ALERT  : $(cat $S/ALERT)"
[ -f $S/PAUSE ] && echo "PAUSED : yes (/opt/teamlink-sync/PAUSE exists)"
echo "timer  : $(systemctl is-active teamlink-sync.timer 2>/dev/null)  last run: $(systemctl show -p ActiveEnterTimestamp --value teamlink-sync.service 2>/dev/null)"
echo "GitHub main on the server copy: $(git -C /opt/teamlink-src log -1 --format='%h %cd %s' --date=format:'%d-%b %H:%M' 2>/dev/null | cut -c1-100)"
echo '---- last 30 lines of the deploy log ----'
tail -n 30 $S/sync.log 2>/dev/null
'@
Write-Host "[1/2] The live auto-deploy (nothing changes)..." -ForegroundColor Cyan
$Look.Replace("`r", "") | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the server.' }
$ok = Read-Host "`nType YES to run the deploy from GitHub now"
if ($ok.Trim() -ne 'YES') { Write-Host 'Not run.' -ForegroundColor Yellow; exit 0 }
Write-Host "[2/2] Deploying GitHub main to the live site (a few minutes)..." -ForegroundColor Cyan
ssh $VpsHost 'rm -f /opt/teamlink-sync/PAUSE; /opt/teamlink-sync/teamlink-sync.sh 2>&1 | tail -n 25; echo; echo "STATUS : $(cat /opt/teamlink-sync/STATUS)"'
Write-Host "`nSend these lines to Claude if the STATUS does not say the deploy finished." -ForegroundColor Yellow
