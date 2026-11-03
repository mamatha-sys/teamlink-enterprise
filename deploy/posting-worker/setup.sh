#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# NAUKRI / SHINE / FOUNDIT AUTOMATIC POSTING ON THE LIVE SERVER (founder 2026-11-03: "Both: automate + link").
# Run ON THE VPS as root, ONCE, after the page settings of the boards are calibrated (backend/src/portals/selectors/*.json
# "verified": true) and the company logins are saved in Administration > Integrations > Job portals.
#
#   bash /opt/teamlink-enterprise/deploy/posting-worker/setup.sh            # installs and starts the worker
#   bash /opt/teamlink-enterprise/deploy/posting-worker/setup.sh --stop     # stops and removes it again
#
# What it does:
#   1. installs the headless Chromium that the browser engine (Playwright) drives, with its system libraries
#   2. starts "npm run posting-worker" under pm2 as teamlink-posting-worker, with TL_ALLOW_REAL_POSTING=1
#      (the real-posting gate: without it every Naukri / Shine / Foundit post becomes a by-hand task)
#   3. saves the pm2 list so it comes back after a reboot
# The API places (Facebook, Instagram, Threads, LinkedIn post, Telegram) do NOT need this: they post at once.
# ---------------------------------------------------------------------------
set -euo pipefail
APP=/opt/teamlink-enterprise/backend
NAME=teamlink-posting-worker

if [ "${1:-}" = "--stop" ]; then
  pm2 delete "$NAME" 2>/dev/null || true
  pm2 save
  echo "Stopped: $NAME is no longer running. Naukri / Shine / Foundit posts become by-hand tasks again."
  exit 0
fi

cd "$APP"
for f in src/portals/selectors/naukri.json src/portals/selectors/shine.json src/portals/selectors/foundit.json; do
  if ! grep -q '"verified": *true' "$f" 2>/dev/null; then
    echo "WARNING: $f is not verified yet - that board will still be posted by hand until it is calibrated."
  fi
done

echo "1/3 Installing the browser for the posting engine (a few minutes the first time)..."
npx playwright install --with-deps chromium

echo "2/3 Starting $NAME ..."
pm2 delete "$NAME" 2>/dev/null || true
TL_ALLOW_REAL_POSTING=1 NODE_ENV=production pm2 start npm --name "$NAME" --cwd "$APP" -- run posting-worker
pm2 save

echo "3/3 Done. Check it with:  pm2 logs $NAME --lines 50"
