# ---------------------------------------------------------------------------
# WHY IS THE AI CALL VOICE SLOW / WHY DOES IT HEAR WRONG? (founder 2026-11-09: "voice struck avuthundhi", "candidate voice correct ga read cheyaleka pothundhi")
#
#   .\check-ai-voice-load-on-vps.ps1
# 1. Shows (nothing changes): how many processor cores the server has, how busy it is, what uses the most processor (is it Ollama?), the AI voice services
#    (voice, ears, Whisper) and which Whisper models they use.
# 2. Then asks YES to make the ears more exact for OPEN answers (city, years, notice period, qualification): it sets WHISPER_MODEL_OPEN=small in
#    /opt/ai-voice/whisper.env and restarts only the Whisper service (the first start downloads the small model, about 0.5 GB; a call going on at that moment is cut).
#    Yes / no answers stay on the quick model. To go back, delete the WHISPER_MODEL_OPEN line from that file and restart ai-voice-whisper.
# Send everything it prints to Claude.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'
$Look = @'
echo "cores  : $(nproc)    $(uptime)"
echo "memory : $(free -m | awk 'NR==2{print $3 " MB used of " $2 " MB"}')"
echo '---- the 8 programs using the most processor right now ----'
ps -eo pcpu,pmem,etime,comm,args --sort=-pcpu | head -n 9 | cut -c1-150
echo '---- AI voice services ----'
for s in ai-voice-stt ai-voice-whisper ai-voice-kokoro asterisk ollama; do echo "$s : $(systemctl is-active $s 2>/dev/null)"; done
echo '---- Whisper settings (the key is hidden) ----'
grep -v KEY /opt/ai-voice/whisper.env 2>/dev/null || echo 'no /opt/ai-voice/whisper.env'
echo '---- ears for Telugu / Hindi (the key is hidden) ----'
grep -v KEY /opt/ai-voice/stt.env 2>/dev/null | head -n 12
echo '---- Ollama: models loaded now ----'
curl -s -m 5 http://127.0.0.1:11434/api/ps 2>/dev/null | head -c 600; echo
'@
Write-Host "[1/2] The AI voice on the server (nothing changes)..." -ForegroundColor Cyan
$Look.Replace("`r", "") | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'Could not read the server.' }
$ok = Read-Host "`nType YES to make open answers more exact (Whisper small for city / years / notice period)"
if ($ok.Trim() -ne 'YES') { Write-Host 'Nothing changed.' -ForegroundColor Yellow; exit 0 }
$Apply = @'
F=/opt/ai-voice/whisper.env
[ -f $F ] || { echo 'no whisper.env'; exit 1; }
cp $F $F.bak-before-open-model
grep -q '^WHISPER_MODEL_OPEN=' $F && sed -i 's/^WHISPER_MODEL_OPEN=.*/WHISPER_MODEL_OPEN=small/' $F || echo 'WHISPER_MODEL_OPEN=small' >> $F
systemctl restart ai-voice-whisper
sleep 20
echo "ai-voice-whisper : $(systemctl is-active ai-voice-whisper)"
grep -v KEY $F
journalctl -u ai-voice-whisper -n 8 --no-pager 2>/dev/null | cut -c1-160
'@
Write-Host "[2/2] Setting the exact model for open answers..." -ForegroundColor Cyan
$Apply.Replace("`r", "") | ssh $VpsHost 'tr -d ''\r'' | bash -s'
Write-Host "`nPlace one test call. Send these lines to Claude." -ForegroundColor Yellow
