#!/bin/sh
# First-time setup on the Linux server. Run from the cloned folder:
#   cd ~/game-server-portal && ./deploy/setup.sh
# Safe to run again.
set -eu
# Always the system Node.js 24 (/usr/bin), even if nvm put an older one first in this terminal.
export PATH="/usr/bin:$PATH"
cd "$(dirname "$0")/.."
here="$(pwd)"

if [ "$here" != "$HOME/game-server-portal" ]; then
  echo "Clone this repository to ~/game-server-portal (the systemd units expect it there)."
  exit 1
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "Node.js 24 is required at /usr/bin/node. Install it with:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

# Let this user's services run without anyone logged in, and start at boot.
if [ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null)" != "yes" ]; then
  echo "Enabling lingering for $USER (asks for your sudo password once)…"
  sudo loginctl enable-linger "$USER"
fi

mkdir -p ~/.config/systemd/user ~/games/assetto-corsa data
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload

[ -f .env ] || { cp .env.example .env; sed -i "s|/home/YOUR_USER|$HOME|g" .env; echo "Created .env"; }
[ -f portal.config.json ] || { cp portal.config.example.json portal.config.json; sed -i "s|/home/YOUR_USER|$HOME|g" portal.config.json; echo "Created portal.config.json"; }

npm ci
npm run build
systemctl --user enable game-portal >/dev/null 2>&1
systemctl --user restart game-portal

echo
echo "Portal running on http://127.0.0.1:3100 (this machine only)."
echo "Next:"
echo "  1. nano .env                 → Cloudflare Access team domain + AUD tag"
echo "  2. nano portal.config.json   → your public game address and friends' names"
echo "  3. ./deploy/install-assettoserver.sh main <your current AC server folder>"
echo "  4. systemctl --user restart game-portal"
