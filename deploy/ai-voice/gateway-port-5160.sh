#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# The office SIM gateway registers on UDP 5160 instead of 5060 (2 Nov 2026).
# Tested from the office: UDP 5060 never reaches the server (the office internet blocks the SIP port), while other UDP
# ports - with SIP messages in them - do. So Asterisk gets a second SIP transport on 5160 and the gateway's account
# (teamlink-gw) uses it. 5060 stays as it is.
#
# Run from the office laptop:   ssh root@72.61.233.104 'bash -s' < deploy/ai-voice/gateway-port-5160.sh
# Then: Hostinger firewall rule "UDP 5060 from 183.82.4.247" -> 5160, and in the gateway (VoIP > SIP Settings) Registrar Port 5160.
# Undo: cp the backup it prints back to /etc/asterisk/pjsip.conf and: systemctl restart asterisk
# ---------------------------------------------------------------------------
set -e
F=/etc/asterisk/pjsip.conf
B="$F.bak-before-port5160-$(date +%Y%m%d-%H%M%S)"
cp -p "$F" "$B"
echo "backup: $B"
python3 - <<'PY'
p = "/etc/asterisk/pjsip.conf"
s = open(p).read()
gw = """[transport-gw]
type=transport
protocol=udp
bind=0.0.0.0:5160
external_media_address=72.61.233.104
external_signaling_address=72.61.233.104
; the office internet blocks UDP 5060, so the office SIM gateway registers on 5160 (2 Nov 2026)

"""
if "[transport-gw]" not in s:
    i = s.index("[provider-auth]") if "[provider-auth]" in s else 0
    s = s[:i] + gw + s[i:]
old = "[teamlink-gw]\ntype=endpoint\ntransport=transport-udp\n"
if old in s:
    s = s.replace(old, "[teamlink-gw]\ntype=endpoint\ntransport=transport-gw\n")
open(p, "w").write(s)
print("pjsip.conf updated")
PY
systemctl restart asterisk
sleep 4
echo "asterisk: $(systemctl is-active asterisk)"
ss -ulpn | grep -E ":(5060|5160) " || true
asterisk -rx "pjsip show transports" | grep -E "transport-" || true
echo "done: the gateway can now register on UDP 5160"
