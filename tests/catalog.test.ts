import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { type Catalog, editedCarSkins, loadCatalog, mergeContent, putEntry, saveCatalog, withoutHiddenSkins } from "@/lib/games/assetto-corsa/catalog";
import { scanContent, type Content } from "@/lib/games/assetto-corsa/content";
import { allowMissingContent } from "@/lib/games/assetto-corsa/extra-config";
import { loadPresets, renameCarInPresets, savePresets, type EntryPreset } from "@/lib/games/assetto-corsa/entry-presets";
import { validateSettings, writeSettings } from "@/lib/games/assetto-corsa/server-config";

const fixture = path.join(import.meta.dirname, "fixtures", "assetto-corsa");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ac-catalog-"));
  await cp(fixture, dir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const catalog: Catalog = {
  cars: [
    { id: "rss_formula_hybrid_2021", name: "Formula Hybrid 2021", skins: ["01_blue", "00_red"] }, // only on players' PCs
    { id: "wdts_nissan_silvia_s15", name: "Nissan Silvia S15 (WDTS)", skins: [] }, // on server without ui json: better name
  ],
  tracks: [
    { id: "shuto_revival_project_beta", name: "Shutoko Revival Project", layouts: [{ id: "heiwajima_pa_n", name: "Heiwajima PA North", pitboxes: 60 }, { id: "daikoku", name: "", pitboxes: null }] },
    { id: "pk_akina", name: "Akina", layouts: [{ id: "", name: "Akina Downhill", pitboxes: 16 }] },
  ],
};

test("hand-added cars and tracks are merged with what's on the server", async () => {
  const content = mergeContent(await scanContent(dir), catalog);

  const formula = content.cars.find((c) => c.id === "rss_formula_hybrid_2021")!;
  assert.deepEqual(formula, { id: "rss_formula_hybrid_2021", name: "Formula Hybrid 2021", brand: "", skins: ["00_red", "01_blue"], onServer: false, manual: true });
  const silvia = content.cars.find((c) => c.id === "wdts_nissan_silvia_s15")!;
  assert.equal(silvia.name, "Nissan Silvia S15 (WDTS)");
  assert.equal(silvia.onServer && silvia.manual, true);
  assert.equal(content.cars.length, 4);

  const shuto = content.tracks.find((t) => t.id === "shuto_revival_project_beta")!;
  assert.deepEqual(
    shuto.layouts.map((l) => [l.id, l.name, l.pitboxes]),
    [["daikoku", "Daikoku", null], ["heiwajima_pa_n", "Heiwajima PA North", 60]],
  );
  const akina = content.tracks.find((t) => t.id === "pk_akina")!;
  assert.equal(akina.name, "Akina");
  assert.deepEqual(akina.layouts.map((l) => [l.id, l.pitboxes, l.onServer]), [["", 16, true]]);
});

test("settings can use hand-added cars, tracks and skins", async () => {
  const content = mergeContent(await scanContent(dir), catalog);
  const result = validateSettings(
    {
      name: "Shuto night",
      password: "",
      track: "shuto_revival_project_beta",
      layout: "heiwajima_pa_n",
      cspVersion: null,
      cspExtra: "",
      entries: [
        { car: "rss_formula_hybrid_2021", skin: "01_blue", count: 1 },
        { car: "rss_formula_hybrid_2021", skin: "", count: 2 },
        { car: "wdts_nissan_silvia_s15", skin: "", count: 1 },
      ],
      damage: 100,
      tyreWear: 100,
      raceLaps: 5,
      startTime: "22:00",
      trackTemp: 6,
      airTemp: 18,
    },
    content,
  );
  assert.ok(result.ok);

  await writeSettings(dir, result.settings, content);
  const entryList = await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8");
  assert.deepEqual([...entryList.matchAll(/SKIN=(.*)/g)].map((m) => m[1]), ["01_blue", "00_red", "01_blue", ""]);
  const extra = await readFile(path.join(dir, "cfg", "extra_cfg.yml"), "utf8");
  assert.match(extra, /^EnableServerDetails: true\nIgnoreConfigurationErrors:\n {2}MissingCarChecksums: true\n {2}MissingTrackParams: true\n$/);
});

test("catalog file round-trips and a missing file is an empty catalog", async () => {
  const file = path.join(dir, "data", "catalog-assetto.json");
  assert.deepEqual(await loadCatalog(file), { cars: [], tracks: [] });
  await saveCatalog(file, catalog);
  assert.deepEqual(await loadCatalog(file), catalog);
});

test("extra_cfg.yml: only the two flags change, comments and other settings stay", () => {
  const before = [
    "# AssettoServer config",
    "EnableAi: true",
    "IgnoreConfigurationErrors:",
    "  MissingCarChecksums: false # careful",
    "  WrongServerDetails: false",
    "",
    "  UnsafeAdminWhitelist: false",
    "RearWheelsHittingWallsBoost: 1",
  ].join("\r\n");
  assert.equal(
    allowMissingContent(before),
    [
      "# AssettoServer config",
      "EnableAi: true",
      "IgnoreConfigurationErrors:",
      "  MissingTrackParams: true",
      "  MissingCarChecksums: true # careful",
      "  WrongServerDetails: false",
      "",
      "  UnsafeAdminWhitelist: false",
      "RearWheelsHittingWallsBoost: 1",
    ].join("\r\n"),
  );
  const done = allowMissingContent(before);
  assert.equal(allowMissingContent(done), done);
  assert.equal(allowMissingContent(""), "IgnoreConfigurationErrors:\n  MissingCarChecksums: true\n  MissingTrackParams: true\n");
  assert.equal(allowMissingContent("IgnoreConfigurationErrors: {}\nA: 1\n"), "IgnoreConfigurationErrors:\n  MissingTrackParams: true\n  MissingCarChecksums: true\nA: 1\n");
});

test("entry list presets round-trip, sorted by name", async () => {
  const file = path.join(dir, "data", "entry-presets-assetto.json");
  assert.deepEqual(await loadPresets(file), []);
  const preset = (name: string): EntryPreset => ({ name, entries: [{ car: "ks_mazda_miata", skin: "red", count: 4 }], savedBy: "Alex", savedAt: "2026-10-17T10:00:00.000Z" });
  await savePresets(file, [preset("Touge"), preset("drift night")]);
  assert.deepEqual((await loadPresets(file)).map((p) => p.name), ["drift night", "Touge"]);
});

test("editing keeps an entry in place, can fix its folder name, but won't clash with another", () => {
  const list = [
    { id: "a_car", name: "A" },
    { id: "typo_car", name: "B" },
    { id: "c_car", name: "C" },
  ];
  // Editing the name only.
  const named = putEntry(list, { id: "typo_car", name: "Better B" }, "typo_car");
  assert.ok(named.ok && named.replaced);
  assert.deepEqual(named.ok && named.list.map((x) => `${x.id}:${x.name}`), ["a_car:A", "typo_car:Better B", "c_car:C"]);
  // Fixing the folder name keeps the position.
  const fixed = putEntry(list, { id: "fixed_car", name: "B" }, "typo_car");
  assert.deepEqual(fixed.ok && fixed.list.map((x) => x.id), ["a_car", "fixed_car", "c_car"]);
  // Renaming onto a folder name that's already in the list is refused.
  const clash = putEntry(list, { id: "c_car", name: "B" }, "typo_car");
  assert.equal(clash.ok, false);
  // Adding (no originalId) appends, or replaces the same folder name as before.
  const added = putEntry(list, { id: "d_car", name: "D" });
  assert.ok(added.ok && !added.replaced && added.list.length === 4);
  const same = putEntry(list, { id: "a_car", name: "A2" });
  assert.ok(same.ok && same.replaced && same.list.length === 3);
});

test("saved grids follow a car whose folder name was corrected", () => {
  const preset = (name: string, car: string): EntryPreset => ({ name, entries: [{ car, skin: "red", count: 2 }, { car: "other", skin: "", count: 1 }], savedBy: "Alex", savedAt: "2026-10-21T10:00:00.000Z" });
  const { presets, changed } = renameCarInPresets([preset("One", "typo_car"), preset("Two", "fine_car")], "typo_car", "fixed_car");
  assert.equal(changed, 1);
  assert.deepEqual(presets[0].entries.map((e) => e.car), ["fixed_car", "other"]);
  assert.deepEqual(presets[1].entries.map((e) => e.car), ["fine_car", "other"]);
});

test("server skins removed in the editor are hidden from the lists, and can be brought back", () => {
  // Form showed typed skin "my_livery" and the server's "rookie_5" + "rookie_9"; the user removed rookie_9.
  const edit = editedCarSkins(["my_livery", "rookie_5"], ["rookie_5", "rookie_9"]);
  assert.deepEqual(edit, { skins: ["my_livery"], hiddenSkins: ["rookie_9"] });

  const content: Content = {
    cars: [{ id: "rss_car", name: "RSS", brand: "", skins: ["my_livery", "rookie_5", "rookie_9"], onServer: true, manual: true }],
    tracks: [],
  };
  const catalog: Catalog = { cars: [{ id: "rss_car", name: "RSS", skins: ["my_livery"], hiddenSkins: ["rookie_9"] }], tracks: [] };
  assert.deepEqual(withoutHiddenSkins(content, catalog).cars[0].skins, ["my_livery", "rookie_5"]);

  // Next edit: rookie_9 isn't shown any more; typing it back in un-hides it.
  assert.deepEqual(editedCarSkins(["my_livery", "rookie_5", "rookie_9"], ["rookie_5"], ["rookie_9"]), {
    skins: ["my_livery", "rookie_9"],
    hiddenSkins: [],
  });
  // Adding (no server skins shown) never hides anything and keeps earlier hidden ones.
  assert.deepEqual(editedCarSkins(["x"], [], ["rookie_9"]), { skins: ["x"], hiddenSkins: ["rookie_9"] });
});
