# Handbook

How to run, use and fix the game server portal and the Assetto Corsa server day to day.
`README.md` covers how it's built and the first-time install; this file is the "how do I…?" guide.

---

## At a glance

| What | Where |
| --- | --- |
| Portal (website) | `https://servers.<your domain>`: sign in with the emailed code |
| Join the AC server | `<publicHost>:8081` in Content Manager, or the **Open in Content Manager** button on the dashboard |
| Portal code | `~/game-server-portal` on the server (GitHub repo `game-server-portal`) |
| AC server files | `~/games/assetto-corsa/main` (`AssettoServer`, `cfg/`, `content/`, `plugins/`) |
| Portal settings | `~/game-server-portal/.env` and `~/game-server-portal/portal.config.json` |
| Portal's own data | `~/game-server-portal/data/` (change log, hand-added cars/tracks, saved grids) |

**Ports:** AssettoServer uses **TCP+UDP 9600** and **TCP 8081**, forwarded on the router. The portal
listens only on `127.0.0.1:3100` and is reached through the Cloudflare Tunnel. The blog uses 8080
in Docker, behind its own separate tunnel.

**What runs where:**

| Service | Kind | Starts on boot |
| --- | --- | --- |
| `game-portal` | systemd **user** service (your account) | yes |
| `assetto-corsa@main` | systemd **user** service (your account) | yes |
| `cloudflared` | systemd **system** service (portal tunnel) | yes |
| blog (`site-*` containers) | Docker Compose in `~/site` | yes |

---

## Using the portal

### Signing in

Open the portal address and you get a Cloudflare page. Type your email, click **Send me a code**, and
enter the code from your inbox (sender: Cloudflare). Only emails listed in the Access policy get a code.
For everyone else, Cloudflare says a code was sent but none ever arrives, which is on purpose.

### Dashboard

One card per game server, showing:
- the current track, cars and session (slots, laps, start time, damage, tyre wear)
- the join address
- live status, uptime and who's online, refreshed every 5 seconds
- **Start / Restart / Stop** buttons, which warn you if people are connected

"Recent changes" shows who did what.

### Changing the Assetto Corsa setup

Click **Change settings**. Nothing changes on the server until you hit **Save & restart server**, which
restarts it and disconnects anyone driving.

- **Track / Layout**: anything in the server's `content/tracks` plus anything added on the Cars & tracks page.
- **Requires CSP build**: players need Custom Shaders Patch at least this build to join (for example 4116).
  Leave it empty to let anyone join. CSP-only cars and tracks (names ending in `_csp`) need it.
- **Grid**: one row per car, each with a skin and a number of slots.
  - **+** adds the same car again, for example in another skin.
  - *Mix of all skins* spreads the known skins over that car's slots.
  - *Default skin* means the server doesn't know any skins for that car.
  - The total becomes the server's player limit (`MAX_CLIENTS`). It can't be more than the track's pit boxes.
- **Saved grids**: type a name and click **Save grid as preset**. Later pick it under **Load a saved grid**, then Save & restart.
- **Session**:
  - **Damage** and **Tyre wear**: 0–100 %.
  - **Race laps**: only shown if the server has a race session.
  - **Start time**: 24-hour time. Plain Assetto Corsa only shows 08:00–18:00; other times need CSP.
    Times snap to 3¾-minute steps.
- **Server name / password**: what shows in the lobby, and the password to join.

### Adding a new mod (car or track)

The server only needs the mod's **folder name**. Every player needs the mod installed on their own PC.

1. Find the folder name on your PC: `assettocorsa\content\cars\<folder>` or `…\content\tracks\<folder>`.
   Content Manager's *Folder* button opens it.
2. In the portal, go to **Change settings → Add cars & tracks**.
   - **Car**: the folder name, plus an optional display name and skin folder names (from `…\cars\<car>\skins\`).
   - **Track**: the folder name. If it has several layouts (sub-folders that each contain a `data` folder,
     like `ks_nordschleife\endurance`), add one row per layout. Pit boxes are optional but give you a slot limit.
3. It shows up in the settings lists straight away.

The **In use, but not in the lists yet** box on that page adds everything the server is currently set up
with in one click.

Made a mistake? Click **Edit** next to a hand-added car or track to change its display name, skins, layouts or folder name. Saved grids follow a corrected car folder name automatically. Folders that exist on the server keep their name. Skins the server provides (its `skins/` folder or the current entry list) show as **on server**: ✕ hides one from the skin lists without touching any files, and typing its name back in with **+ Add a skin** brings it back.

---

## People

**Add a friend**
1. **Required:** add their email in Cloudflare: Zero Trust → **Access → Applications → Game Servers →
   Policies → Friends** → Include → Emails. This takes effect immediately.
2. **Optional:** add `"their@email": "Name"` under `users` in `portal.config.json`, then
   `systemctl --user restart game-portal`. Without it, "Recent changes" shows the part of their
   email before the @.

**Remove a friend**
1. Take their email out of the Cloudflare policy.
2. To lock them out before their current session ends, also revoke their session under the
   Zero Trust users page ("Users" / "My Team").

---

## Starting and stopping things

Run these over SSH as your normal user, **without `sudo`**. With `sudo` they look for system services
and report "not found".

```bash
# Portal (website)
systemctl --user restart game-portal
systemctl --user stop game-portal
systemctl --user start game-portal

# Assetto Corsa server: stopping/restarting kicks everyone who's driving
systemctl --user restart assetto-corsa@main
systemctl --user stop assetto-corsa@main
systemctl --user start assetto-corsa@main

# Is it running? Since when?
systemctl --user status game-portal assetto-corsa@main

# Live logs (Ctrl+C stops watching, not the service)
journalctl --user -u assetto-corsa@main -f
journalctl --user -u game-portal -f

# Start on boot: on / off
systemctl --user enable assetto-corsa@main
systemctl --user disable assetto-corsa@main
```

The two are independent. Stopping the portal leaves the game server running, and the other way round.

**Never start `./AssettoServer` by hand while the service is running.** Both would fight over ports
9600/8081. Use the commands above or the portal's buttons.

The portal's tunnel is a system service (needs `sudo`):

```bash
sudo systemctl status cloudflared
sudo systemctl restart cloudflared
```

---

## Updating

### The portal

Changes go to GitHub first, then the server pulls them:

```bash
~/game-server-portal/deploy/update.sh
```

This pulls the code, installs packages, builds, and restarts only the website. The game server keeps
running. It takes about a minute.

### AssettoServer itself

The server runs **AssettoServer 0.0.54**. To move to the newest release:

```bash
~/game-server-portal/deploy/install-assettoserver.sh main
```

This keeps `cfg/`, `content/` and `presets/`, and stops/restarts the server around the update. Newer
versions can change settings, so read the AssettoServer release notes first and watch the log after
starting (`journalctl --user -u assetto-corsa@main -f`).

---

## Files the portal touches (and backups)

| File | What the portal changes | Backup |
| --- | --- | --- |
| `cfg/server_cfg.ini` | `NAME`, `PASSWORD`, `TRACK`, `CONFIG_TRACK`, `CARS`, `MAX_CLIENTS`, `DAMAGE_MULTIPLIER`, `TYRE_WEAR_RATE`, `SUN_ANGLE`, `[RACE] LAPS`; everything else stays as it was | `server_cfg.ini.bak` (previous version) |
| `cfg/entry_list.ini` | rewritten only when the grid really changes | `entry_list.ini.bak` |
| `cfg/extra_cfg.yml` | only makes sure `IgnoreConfigurationErrors: MissingCarChecksums/MissingTrackParams: true` exist, and puts back a missing `---` before plugin sections | `extra_cfg.yml.before-fix` (from the first fix by hand) |
| `data/activity.jsonl` | "Recent changes" | — |
| `data/catalog-assetto.json` | cars/tracks added by hand | — |
| `data/entry-presets-assetto.json` | saved grids | — |

To undo the last save, copy the `.bak` files back over the originals, then restart the server.

**Settings files:**
- `.env`: `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the Access app's
  Audience tag). If they're missing, the portal lets **nobody** in.
- `portal.config.json`: `publicHost` (what friends type to join: your public IP or a DNS-only name),
  `users` (email → display name), and `instances` (the game servers it manages).

Restart the portal after editing either file.

---

## Server care: things learned the hard way

- **Don't interrupt package installs.** An `apt` job cut off when an SSH connection dropped left the
  system half-updated, and the next boot stopped at a disk check. Run `apt` on the machine itself, or
  inside `tmux` over SSH (`tmux`, then reattach with `tmux attach` after a dropped connection).
  Don't run `apt autoremove` unless you've read the list it prints.
- **Boot stops at "BusyBox … (initramfs)" with "/dev/sda3 requires a manual fsck":** at that prompt run
  `fsck -y /dev/sda3` (repeat until it reports clean), then `exit`.
- **Two Node.js versions:** the system has **Node 24** at `/usr/bin/node`, which the portal uses.
  Your terminal may show **v16** from `nvm` (`~/.nvm`). That's fine. To use 24 in a terminal, run
  `nvm use system`. Don't remove the `nodejs` package.
- **AssettoServer won't start with "While parsing a block mapping, did not find expected key":**
  `extra_cfg.yml` is missing the `---` line before a plugin section (`!SomethingConfiguration`).
  Add it back. Saving settings in the portal also fixes it.

---

## Troubleshooting

| Symptom | Check / fix |
| --- | --- |
| Sign-in page shows only "Sign in with Cloudflare" | One-time PIN isn't enabled for the app (see **Cloudflare setup** below) |
| No email code arrives | Is the email in the Access policy (exact spelling)? Check spam. Codes only go to allowed emails. |
| Portal says "Not signed in" after logging in | `.env` values wrong or missing → fix, then `systemctl --user restart game-portal` |
| Cloudflare error 1033 / 502 on the portal address | `sudo systemctl status cloudflared`, `systemctl --user status game-portal` |
| Dashboard shows the game server as "Crashed" | `journalctl --user -u assetto-corsa@main -n 50`: the reason is near the end |
| Server runs but nobody can join | Router forwards 9600 TCP+UDP and 8081 TCP? Players have the mods (same folder names) and the CSP build? Right password? |
| "Missing car/track" in Content Manager | That player doesn't have the mod, or it's installed under a different folder name |
| A car or track is missing from the lists | Add it on **Cars & tracks** |
| Player list on the dashboard stays empty | Server still starting, or the HTTP port in `server_cfg.ini` changed |

---

## Cloudflare setup (reference)

- **Tunnel** (Zero Trust → Networks → Tunnels): public hostname `servers.<your domain>` →
  `http://localhost:3100`. `cloudflared` runs on the host as a system service.
- **Access app** (Zero Trust → Access → Applications → Game Servers):
  - **Login method: One-time PIN**, which first has to exist under
    *Settings → Authentication → Login methods → Add new → One-time PIN*.
  - Then in the app's **Login methods**, tick **One-time PIN**. If it's the only one ticked, the
    login page goes straight to the email box.
  - **Policy "Friends"**: Allow, Include → Emails.
- `.env` holds the app's **AUD tag** and the **team domain**.
