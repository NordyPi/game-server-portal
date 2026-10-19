import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { addMissingToCatalog, mergeContent, missingFromLists, withEntryListSkins } from "@/lib/games/assetto-corsa/catalog";
import { scanContent } from "@/lib/games/assetto-corsa/content";
import { parseEntryList } from "@/lib/games/assetto-corsa/entries";
import { readServerCfg, validateSettings, writeSettings } from "@/lib/games/assetto-corsa/server-config";
import { formatTrackSetting, parseTrackSetting } from "@/lib/games/assetto-corsa/track-setting";
import { allowMissingContent } from "@/lib/games/assetto-corsa/extra-config";

// Shaped like the real server: a Content Manager setup that requires a CSP version, keeps a
// track under content/tracks/csp, and uses cars/skins the server has no files for.

const fixture = path.join(import.meta.dirname, "fixtures", "assetto-corsa");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ac-real-"));
  await cp(fixture, dir, { recursive: true });
  const cfg = path.join(dir, "cfg", "server_cfg.ini");
  await writeFile(
    cfg,
    (await readFile(cfg, "utf8"))
      .replace("TRACK=pk_akina", "TRACK=csp/4116/../D/../fn_nurburgring")
      .replace("CONFIG_TRACK=", "CONFIG_TRACK=nordschleife")
      .replace("CARS=ks_mazda_miata;ks_toyota_ae86_drift", "CARS=rss_formula_rss_4_2024;ks_mazda_miata;slang_renault5_turbo"),
  );
  await writeFile(
    path.join(dir, "cfg", "entry_list.ini"),
    "[CAR_0]\r\nMODEL=rss_formula_rss_4_2024\r\nSKIN=rookie_9\r\n\r\n[CAR_1]\r\nMODEL=rss_formula_rss_4_2024\r\nSKIN=rookie_5\r\n\r\n[CAR_2]\r\nMODEL=ks_mazda_miata\r\nSKIN=green\r\n",
  );
  // A CSP-required track's files live in content/tracks/csp/<track>.
  await mkdir(path.join(dir, "content", "tracks", "csp", "rt_fuji_speedway", "layout_gp", "data"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("TRACK with a CSP requirement is split into track + CSP build and written back the same way", () => {
  assert.deepEqual(parseTrackSetting("csp/4116/../D/../fn_nurburgring"), { track: "fn_nurburgring", cspVersion: 4116, cspExtra: "D/../" });
  assert.deepEqual(parseTrackSetting("csp/2053/../shuto_revival_project_beta"), { track: "shuto_revival_project_beta", cspVersion: 2053, cspExtra: "" });
  assert.deepEqual(parseTrackSetting("ks_vallelunga"), { track: "ks_vallelunga", cspVersion: null, cspExtra: "" });
  assert.equal(formatTrackSetting({ track: "rt_fuji_speedway", cspVersion: 4116, cspExtra: "D/../" }), "csp/4116/../D/../rt_fuji_speedway");
  assert.equal(formatTrackSetting({ track: "rt_fuji_speedway", cspVersion: null, cspExtra: "D/../" }), "rt_fuji_speedway");
});

test("tracks under content/tracks/csp are found", async () => {
  const { tracks } = await scanContent(dir);
  const fuji = tracks.find((t) => t.id === "rt_fuji_speedway");
  assert.deepEqual(fuji?.layouts.map((l) => l.id), ["layout_gp"]);
  assert.ok(!tracks.some((t) => t.id === "csp"));
});

test("cars, skins and the track the server uses can be added to the lists in one go", async () => {
  const cfg = await readServerCfg(dir);
  assert.ok(cfg);
  assert.equal(cfg.settings.track, "fn_nurburgring");
  assert.equal(cfg.settings.cspVersion, 4116);

  const slots = parseEntryList(await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8"));
  const content = withEntryListSkins(await scanContent(dir), slots);
  // Skins from the entry list become options even without skins/ folders on the server.
  assert.deepEqual(content.cars.find((c) => c.id === "ks_mazda_miata")?.skins, ["blue", "green", "red", "white"]);

  const missing = missingFromLists({ ...cfg.settings, cars: cfg.cars }, slots, content);
  assert.deepEqual(missing, {
    cars: [
      { id: "rss_formula_rss_4_2024", skins: ["rookie_5", "rookie_9"] },
      { id: "slang_renault5_turbo", skins: [] },
    ],
    track: { id: "fn_nurburgring", layout: "nordschleife" },
  });

  const catalog = addMissingToCatalog({ cars: [], tracks: [] }, missing);
  const merged = withEntryListSkins(mergeContent(await scanContent(dir), catalog), slots);
  assert.deepEqual(missingFromLists({ ...cfg.settings, cars: cfg.cars }, slots, merged), { cars: [], track: null });

  // Saving with a new track keeps the CSP requirement; clearing it removes the prefix.
  const input = { ...cfg.settings, startTime: "11:30" };
  const v = validateSettings({ ...input, track: "rt_fuji_speedway", layout: "layout_gp" }, merged);
  assert.ok(v.ok);
  await writeSettings(dir, v.settings, merged);
  const file = path.join(dir, "cfg", "server_cfg.ini");
  const written = await readFile(file, "utf8");
  assert.match(written, /\r\nTRACK=csp\/4116\/\.\.\/D\/\.\.\/rt_fuji_speedway\r\n/);
  assert.match(written, /\r\nCONFIG_TRACK=layout_gp\r\n/);

  const none = validateSettings({ ...input, cspVersion: null }, merged);
  assert.ok(none.ok);
  await writeSettings(dir, none.settings, merged);
  assert.match(await readFile(file, "utf8"), /\r\nTRACK=fn_nurburgring\r\n/);

  // Same grid as before: the hand-made entry list (with its skins) is left alone.
  assert.match(await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8"), /SKIN=rookie_9/);
});

test("extra_cfg.yml: the flags go into the server's own settings, never into a plugin's section", () => {
  // Exactly like the real server's file (plugin section without a "---" line).
  const real = "EnablePlugins:\n  - AutoModerationPlugin\n\n!AutoModerationConfiguration\nWrongWayKick:\n  Enabled: false\n";
  assert.equal(
    allowMissingContent(real),
    "EnablePlugins:\n  - AutoModerationPlugin\nIgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\n\n!AutoModerationConfiguration\nWrongWayKick:\n  Enabled: false\n",
  );
  // As in the AssettoServer docs, with "---".
  const documented = "EnableAi: false\n---\n!AutoModerationConfiguration\nIgnoreConfigurationErrors:\n  Nope: 1\n";
  assert.equal(
    allowMissingContent(documented),
    "EnableAi: false\nIgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\n---\n!AutoModerationConfiguration\nIgnoreConfigurationErrors:\n  Nope: 1\n",
  );
  assert.equal(allowMissingContent(allowMissingContent(real)), allowMissingContent(real));
});
