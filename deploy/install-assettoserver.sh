#!/bin/sh
# Installs or updates AssettoServer in ~/games/assetto-corsa/<instance>.
#
#   ./deploy/install-assettoserver.sh main ~/old-ac-server   first install, copying cfg/ and content/
#                                                            from your current server folder
#   ./deploy/install-assettoserver.sh main                   update to the latest AssettoServer release
#
# cfg/, content/ and presets/ are never overwritten by an update.
set -eu

instance="${1:-}"
import_from="${2:-}"
case "$instance" in
  ''|*[!a-z0-9-]*) echo "Usage: $0 <instance-name> [existing-server-folder]   (name: lowercase letters, digits, dashes)"; exit 1 ;;
esac

dir="$HOME/games/assetto-corsa/$instance"
url="https://github.com/compujuckel/AssettoServer/releases/latest/download/assetto-server-linux-x64.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading the latest AssettoServer…"
curl -fL --progress-bar "$url" -o "$tmp/server.tar.gz"
mkdir -p "$tmp/x" "$dir"
tar -xzf "$tmp/server.tar.gz" -C "$tmp/x"

was_running=no
if systemctl --user is-active --quiet "assetto-corsa@$instance"; then
  was_running=yes
  systemctl --user stop "assetto-corsa@$instance"
fi

for item in "$tmp"/x/* "$tmp"/x/.[!.]*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  case "$name" in cfg|content|presets) [ -e "$dir/$name" ] && continue ;; esac
  rm -rf "${dir:?}/$name"
  cp -a "$item" "$dir/"
done
chmod +x "$dir/AssettoServer"

if [ -n "$import_from" ]; then
  for sub in cfg content; do
    if [ -d "$import_from/$sub" ]; then
      echo "Copying $sub/ from $import_from…"
      mkdir -p "$dir/$sub"
      cp -a "$import_from/$sub/." "$dir/$sub/"
    fi
  done
fi

# Mods usually aren't fully on the server (cars without data.acd, tracks AssettoServer has no
# coordinates for). Tell AssettoServer that's fine; it fills in defaults for every other setting.
# The portal keeps these two flags set (src/lib/games/assetto-corsa/extra-config.ts).
if [ ! -f "$dir/cfg/extra_cfg.yml" ]; then
  mkdir -p "$dir/cfg"
  printf 'IgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\n' > "$dir/cfg/extra_cfg.yml"
fi

systemctl --user daemon-reload
systemctl --user enable "assetto-corsa@$instance" >/dev/null 2>&1

echo
echo "AssettoServer is in $dir"
if [ "$was_running" = yes ]; then
  systemctl --user start "assetto-corsa@$instance"
  echo "Restarted assetto-corsa@$instance."
else
  echo "Stop your old ./acServer first (same ports), then start this one:"
  echo "  systemctl --user start assetto-corsa@$instance"
  echo "  journalctl --user -u assetto-corsa@$instance -f      # watch it boot"
fi
