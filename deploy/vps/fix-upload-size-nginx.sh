#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# UPLOADS BIGGER THAN 1 MB ON THE LIVE SITE (2026-11-02). Checked from outside: https://teamlink.teamlinks.in took a 900 KB request
# but answered nginx's "413 Request Entity Too Large" to a 3 MB one - nginx's default limit. So every LMS document / video over
# ~1 MB was refused before it reached TeamLink. This sets client_max_body_size 64m for the teamlink.teamlinks.in site (LMS videos go
# in 8 MB pieces, documents are up to 25 MB): a smaller value already in the site file is raised, and when there is none at the
# server level (a location's own value does not count for /api) one line is added under the site's server_name. The site file is backed up first (/root/nginx-site-before-upload-size-<time>.conf); if nginx -t fails
# the backup is put back and nothing changes.
# ---------------------------------------------------------------------------
set -e
WANT=64
F=$(grep -lsE 'server_name[^;]*teamlink\.teamlinks\.in' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | head -1)
[ -n "$F" ] || { echo 'STOPPED: no nginx site for teamlink.teamlinks.in found in /etc/nginx/sites-enabled or conf.d'; exit 2; }
F=$(readlink -f "$F")
echo "nginx site file: $F"
echo "now: $(grep -nE 'client_max_body_size' "$F" | tr '\n' ' ' || true)"
[ -z "$(grep -E 'client_max_body_size' "$F")" ] && echo 'now: no client_max_body_size in the site (nginx default 1m)'
if [ "${1:-}" != "--apply" ]; then echo 'DRY RUN: nothing changed.'; exit 0; fi
S=$(date +%Y%m%d-%H%M%S)
B=/root/nginx-site-before-upload-size-$S.conf
cp -a "$F" "$B" && echo "nginx site backed up: $B"
# raise every smaller value (k / m / no unit); leave bigger ones alone
awk -v W=$WANT '
  {
    line = $0; out = ""
    while (match(line, /client_max_body_size[ 	]+[0-9]+[kKmMgG]?;/)) {
      seg = substr(line, RSTART, RLENGTH); v = seg; sub(/client_max_body_size[ 	]+/, "", v); sub(/;$/, "", v)
      u = tolower(substr(v, length(v))); n = v + 0
      mb = (u == "k") ? n / 1024 : (u == "g") ? n * 1024 : (u == "m") ? n : n / 1048576
      if (mb < W) seg = "client_max_body_size " W "m;"
      out = out substr(line, 1, RSTART - 1) seg; line = substr(line, RSTART + RLENGTH)
    }
    print out line
  }' "$B" > "$F"
# A value inside one location (e.g. /jobs) does not cover /api. With no value at the SERVER level (indented at most 4 spaces), one line
# goes under every server_name of this site, with the same indent - live 2026-11-02: only /jobs had 50m, so /api kept nginx's 1m.
if ! grep -qE '^[[:space:]]{0,4}client_max_body_size' "$F"; then
  cp -a "$F" "$F.tmp-upload-size"
  awk -v W=$WANT '/^[[:space:]]*server_name[^;]*teamlink\.teamlinks\.in/ { print; match($0, /^[[:space:]]*/); print substr($0, 1, RLENGTH) "client_max_body_size " W "m;  # uploads: LMS pieces + documents (2026-11-02)"; next } { print }' "$F.tmp-upload-size" > "$F"
  rm -f "$F.tmp-upload-size"
fi
echo "set: $(grep -nE 'client_max_body_size' "$F" | tr '\n' ' ')"
if nginx -t 2>&1; then
  systemctl reload nginx && echo 'NGINX UPLOAD LIMIT RAISED'
else
  cp -a "$B" "$F"; echo 'STOPPED: nginx did not accept the change - the old site file is back, nothing changed.'; exit 5
fi
