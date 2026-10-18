import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { loadCatalog, mergeContent, saveCatalog, type Catalog } from "@/lib/games/assetto-corsa/catalog";
import { scanContent } from "@/lib/games/assetto-corsa/content";
import { allowMissingContent } from "@/lib/games/assetto-corsa/extra-config";
import { loadPresets, savePresets, type EntryPreset } from "@/lib/games/assetto-corsa/entry-presets";
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
      entries: [
        { car: "rss_formula_hybrid_2021", skin: "01_blue", count: 1 },
        { car: "rss_formula_hybrid_2021", skin: "", count: 2 },
        { car: "wdts_nissan_silvia_s15", skin: "", count: 1 },
      ],
      damage: 100,
      tyreWear: 100,
      raceLaps: 5,
      startTime: "22:00",
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
