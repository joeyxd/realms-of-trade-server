#!/usr/bin/env bash
# Pull the latest game and restart it (run on the box): sudo -u marea bash /opt/marea-negra/deploy/update.sh
set -euo pipefail
cd /opt/marea-negra
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
git fetch origin "$BRANCH"
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart marea-negra
sleep 1
curl -fsS "http://127.0.0.1:${PORT:-5173}/status" && echo
