#!/bin/sh
# Update the portal on the server:  ~/game-server-portal/deploy/update.sh
# Game servers keep running; only the website restarts.
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
npm ci
npm run build
systemctl --user restart game-portal
systemctl --user --no-pager status game-portal | head -5
