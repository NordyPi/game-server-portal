# Game server portal

> **Day-to-day use, start/stop commands, adding friends and mods, troubleshooting: see [HANDBOOK.md](HANDBOOK.md).**

A small website on the home Linux server that lets friends manage our game servers without
touching config files or a terminal: pick the track, layout and cars from lists, hit
**Save & restart**, and the server comes back with the new setup.

- **Assetto Corsa** (AssettoServer): track and layout; the grid (which cars, how many of each,
  which skin); damage, tyre wear, race laps and start time; server name and password. Edits
  `server_cfg.ini` and `entry_list.ini`, then restarts the server.
  - **Saved grids:** save the current grid under a name ("Drift night") and load it later in one click.
  - **New mods** go into the lists by folder name, with their skins, on the "Cars & tracks" page.
- Start / stop / restart, live status, who's online, the server log
- "Recent changes" log of who changed what
- Sign-in through **Cloudflare Access** (one-time code to an allowed email; no passwords)
- Coming next: Valheim, Minecraft

**Stack:** Next.js 16 · TypeScript · Tailwind CSS 4 · Zod · systemd user services · Cloudflare Tunnel + Access

---

## How it fits together

```
friend ─https─> Cloudflare Access (email code) ─tunnel─> cloudflared ─> portal :3100 (127.0.0.1 only)
                                                                           │ systemctl --user
                                                                           ▼
                                                     assetto-corsa@main.service → ~/games/assetto-corsa/main
friend's game ──────────── port-forwarded TCP/UDP 9600, TCP 8081 ─────────────────┘
```

- The portal and every game server run as **your own Linux user** as systemd *user* services.
  The portal controls them with `systemctl --user`, so it needs no sudo or root. Servers keep
  running if the portal restarts, restart themselves after a crash, and start on boot.
- The portal runs directly on the machine, not in Docker like the blog, because it has to edit
  the game servers' files and control their services.
- It uses its own Cloudflare Tunnel, separate from the blog's.
- There's no database. Settings live in the game servers' own config files. The portal's own
  config is `portal.config.json`, hand-added cars and tracks are in `data/catalog-*.json`, and the
  activity log is `data/activity.jsonl`.

## Project layout

```
src/
  app/page.tsx                  dashboard: one card per server
  app/servers/[id]/page.tsx     one server: live status, settings form, log, recent changes
  app/actions.ts                Server Actions: start/stop/restart, save settings
  app/api/servers/[id]/live/    polled every 5 s for status, players, log
  lib/games/                    one adapter per game (see "Adding a game")
  lib/games/assetto-corsa/      content scanner, server_cfg/entry_list editing, live player list
  lib/service.ts                systemctl / journalctl (and a fake for local development)
  lib/access.ts, proxy.ts       Cloudflare Access sign-in check
deploy/                         systemd units and setup/update scripts
tests/                          unit tests + a sample AssettoServer folder (tests/fixtures)
```

---

## Local development (Windows)

```bash
npm install
npm run dev        # http://localhost:3100
```

`npm run dev` copies `tests/fixtures/assetto-corsa` to `dev-data/` (a fake server folder with a few
cars and tracks) and uses `portal.config.dev.json`. Start/stop is simulated, and you're signed in
as `dev`. Delete `dev-data/` to reset it.

Checks: `npm run lint`, `npm run typecheck`, `npm test`.

---

## Server setup (first time)

### 1. The portal

```bash
cd ~ && git clone https://github.com/<you>/game-server-portal.git
cd ~/game-server-portal
chmod +x deploy/*.sh
./deploy/setup.sh
```

This needs Node.js 24 at `/usr/bin/node`; the script tells you how to install it if it's missing.
It turns on *lingering* (so your services run without you logged in), installs the systemd units,
creates `.env` and `portal.config.json`, builds the site and starts it on `127.0.0.1:3100`.

### 2. AssettoServer

AssettoServer replaces `acServer`. You don't need SteamCMD: AssettoServer reads the same
`cfg/` and `content/` folders from your friend's Content Manager export. To install it and
bring over your current server's config and content:

```bash
./deploy/install-assettoserver.sh main ~/path/to/current/ac-server
```

Stop the old `./acServer` (it uses the same ports), then:

```bash
systemctl --user start assetto-corsa@main
journalctl --user -u assetto-corsa@main -f     # watch it boot; Ctrl+C to stop watching
```

`cfg/extra_cfg.yml` holds AssettoServer's own settings (traffic AI, CSP features…). The install
script creates it with two lines that let mods work without their files on the server (see
"Adding cars and tracks"). AssettoServer uses defaults for everything else. The portal never
changes anything else in that file.

To update AssettoServer later, run the same script without the folder: `./deploy/install-assettoserver.sh main`.

### 3. Cloudflare Tunnel (separate from the blog's)

1. Install `cloudflared` on the machine itself, not in Docker, so `localhost` reaches the portal.
   Follow **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → Debian**.
   The page shows the apt commands and a `sudo cloudflared service install <token>` line to run.
2. In that tunnel, add a **Public hostname**: `servers.yourdomain.com` → `HTTP` → `localhost:3100`.

### 4. Cloudflare Access (who can sign in)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
   Domain: `servers.yourdomain.com`.
2. Add a policy: **Allow**, *Include* → **Emails** → your friends' addresses.
   Login method: **One-time PIN**.
3. Copy the application's **Audience (AUD) tag** into `CF_ACCESS_AUD` in `.env`.
   Your team domain (**Settings → Custom pages**, e.g. `myteam.cloudflareaccess.com`) goes in
   `CF_ACCESS_TEAM_DOMAIN`.
4. `systemctl --user restart game-portal`

The portal checks Cloudflare's signed token on every request. If `.env` is missing these values,
nobody can get in.

### 5. `portal.config.json`

```json
{
  "publicHost": "play.yourdomain.com",
  "users": { "friend@example.com": "Alex" },
  "instances": [
    { "id": "assetto", "game": "assetto-corsa", "name": "Assetto Corsa",
      "dir": "/home/you/games/assetto-corsa/main", "unit": "assetto-corsa@main.service" }
  ]
}
```

- `publicHost` is what friends put in their game (shown on the dashboard with a Content Manager
  join link). Point a **DNS-only (grey cloud)** record at your home IP, or use the IP itself.
- `users` turns emails into names in the "Recent changes" log.
- Restart the portal after editing: `systemctl --user restart game-portal`.

### 6. Router

Forward to this machine: **TCP+UDP 9600** and **TCP 8081** (Assetto Corsa). Nothing is needed
for the portal itself: it comes in through the tunnel.

## Updating the portal

Push to `main`, then on the server:

```bash
~/game-server-portal/deploy/update.sh
```

---

## Adding cars and tracks

The server never needs a mod's actual files. It only needs the mod's **folder name** in its config,
and everyone who joins needs the mod installed on their own PC.

The lists on the settings page come from two places:

1. **The server's `content/` folder.** Your Content Manager export already put a few small files
   there for the cars and tracks it was built with (each car's `data.acd`, each track's
   `surfaces.ini`). That's what you've been copying over on the flash drive. The portal finds these
   automatically.
2. **The "Cars & tracks" page** (a link next to "Settings"). When you all install a new mod, anyone
   types its folder name there, plus each layout's folder name for tracks with several layouts,
   and (optionally) a car's skin folder names so you can pick a skin in the grid.
   It shows up in the settings lists right away. Nothing is copied to the server. These entries are
   saved in `data/catalog-<server id>.json`.

You find a mod's folder name in `assettocorsa\content\cars\` or `assettocorsa\content\tracks\` on your PC (Content
Manager's *Folder* button opens it). A track has several layouts if its folder has one sub-folder
per layout, each with its own `data` folder (e.g. `ks_nordschleife\endurance\data`).

Typing a name on that page for something that's already on the server just gives it a nicer
display name (server packs often leave out the `ui/` files, so you'd otherwise see `Wdts Nissan Silvia S15`).

**Why AssettoServer accepts cars with no files:** by default AssettoServer refuses to start when a
car has no `data.acd` (used to catch modified car data) or when a mod track isn't in its list of
track locations (used for real-time weather). The portal sets these two lines in
`cfg/extra_cfg.yml` so neither stops your server:

```yaml
IgnoreConfigurationErrors:
  MissingCarChecksums: true
  MissingTrackParams: true
```

Cars that do have `data.acd` on the server still get the anti-cheat check. To add one for a new
mod, copy `content/cars/<car>/data.acd` from a game install (or a new Content Manager export)
to the server.

## The settings page

**Grid.** One row per car: which skin and how many slots. Use **+** on a row to add the same car
again in another skin. *Mix of all skins* spreads the car's known skins over its slots. A car with no
skins listed gets *Default skin*, which leaves `SKIN=` empty. The total can't be more than the
layout's pit boxes. **Save grid as preset** stores the grid under a name. **Load a saved grid**
puts it back, and Save & restart applies it. Presets are kept in
`data/entry-presets-<server id>.json`.

**Session.**

| Setting | In `server_cfg.ini` | Notes |
| --- | --- | --- |
| Damage | `[SERVER] DAMAGE_MULTIPLIER` | 0–100 %, defaults to 100 if the file doesn't set it. |
| Tyre wear | `[SERVER] TYRE_WEAR_RATE` | 0–100 %, defaults to 100 if the file doesn't set it. |
| Race laps | `[RACE] LAPS` | Only shown when the config has a `[RACE]` session. The portal never adds one, because that would change which sessions the server runs. |
| Start time | `[SERVER] SUN_ANGLE` | Typed as 24-hour time. `SUN_ANGLE = 16 × (hours − 13)`, the same formula AssettoServer uses, so 13:00 = 0, 08:00 = −80, 18:00 = 80. It's a whole number, so times snap to 3¾-minute steps (the page shows the real start time). Plain Assetto Corsa only shows 08:00–18:00. Outside that range everyone needs Custom Shaders Patch (CSP). |

**What "Save & restart" does:** it updates `NAME`, `PASSWORD`, `TRACK`, `CONFIG_TRACK`, `CARS`,
`MAX_CLIENTS` (the grid's total), `DAMAGE_MULTIPLIER`, `TYRE_WEAR_RATE`, `SUN_ANGLE` and `[RACE] LAPS`
in `server_cfg.ini`, and leaves everything else (other sessions, weather, comments) as it was.
It only rebuilds `entry_list.ini` when the grid really changed. If the file already has the same
cars, slot counts and chosen skins, it stays as it is, so hand edits to it (AI traffic slots,
ballast) survive a track change. The previous version of each file is kept as `*.bak`.

## Adding a game

Each game is an adapter in `src/lib/games/<game>/`. See `src/lib/games/types.ts` for the steps.
Valheim and Minecraft get their own systemd template (`valheim@.service`, `minecraft@.service`),
an adapter, and a settings form. The dashboard, controls, logs and activity log already work for
any game.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Not signed in" | Open the site through `https://servers.yourdomain.com`, and check `CF_ACCESS_*` in `.env`. |
| Status says "systemd unit not installed" | `cp deploy/systemd/*.service ~/.config/systemd/user/ && systemctl --user daemon-reload` |
| AssettoServer exits with an ICU / globalization error | `sudo apt install libicu-dev` |
| Server starts but nobody can join | Router port forwarding, and check that everyone has the mods installed with the same folder names. `journalctl --user -u assetto-corsa@main` shows errors. |
| Content Manager says a car or track is missing | That player doesn't have the mod, or it's installed under a different folder name than the one typed on the Cars & tracks page. |
| No player list on the dashboard | Server still loading, or the HTTP port in `server_cfg.ini` is blocked locally. |
