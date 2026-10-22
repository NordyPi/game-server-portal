import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parseDetails } from "@/lib/games/assetto-corsa/adapter";
import { parseUiJson, scanContent } from "@/lib/games/assetto-corsa/content";
import { buildEntryList, parseEntryList, slotsFor, slotsSatisfy, type Slot } from "@/lib/games/assetto-corsa/entries";
import { readServerCfg, validateSettings, writeSettings, type AcSettingsInput } from "@/lib/games/assetto-corsa/server-config";
import type { Sessions } from "@/lib/games/assetto-corsa/sessions";
import { formatTime, parseTime, secondsFromSunAngle, sunAngleFromSeconds } from "@/lib/games/assetto-corsa/sun";

const fixture = path.join(import.meta.dirname, "fixtures", "assetto-corsa");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ac-test-"));
  await cp(fixture, dir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("scans cars, skipping folders that aren't cars, with names from ui_car.json or the folder", async () => {
  const { cars } = await scanContent(dir);
  assert.deepEqual(
    cars.map((c) => [c.id, c.name, c.skins]),
    [
      ["ks_mazda_miata", "Mazda MX-5 NA", ["blue", "red", "white"]],
      ["ks_toyota_ae86_drift", "Toyota AE86 Drift", ["panda"]],
      ["wdts_nissan_silvia_s15", "Wdts Nissan Silvia S15", []],
    ],
  );
});

test("scans tracks: multi-layout, single-layout and stripped server-pack tracks", async () => {
  const { tracks } = await scanContent(dir);
  assert.deepEqual(
    tracks.map((t) => [t.id, t.name, t.layouts.map((l) => [l.id, l.pitboxes])]),
    [
      ["ks_nordschleife", "Nordschleife", [["nordschleife", 24], ["endurance", 48], ["tourist", 32]]],
      ["pk_akina", "Pk Akina", [["", null]]],
      ["ks_vallelunga_club", "Vallelunga Club", [["", 12]]],
    ],
  );
});

test("reads ui json that isn't valid JSON", () => {
  const ui = parseUiJson('﻿{ "name": "Car \\"Fast\\"\tEdition",\n "pitboxes": "18", }');
  assert.deepEqual(ui, { name: 'Car "Fast" Edition', brand: undefined, pitboxes: 18 });
});

test("reads the current settings, grid and ports", async () => {
  const cfg = await readServerCfg(dir);
  assert.deepEqual(cfg?.settings, {
    name: "Friday Night Drift",
    password: "",
    track: "pk_akina",
    layout: "",
    cspVersion: null,
    cspExtra: "",
    // Miata slots use red and white, so that row is "automatic"; both AE86 slots are panda.
    entries: [
      { car: "ks_mazda_miata", skin: "", count: 2 },
      { car: "ks_toyota_ae86_drift", skin: "panda", count: 2 },
    ],
    damage: 50,
    trackTemp: 7,
    airTemp: 21,
    tyreWear: 100, // not in the file: default
    sessions: {
      practice: { enabled: true, minutes: 60, canJoin: true }, // no IS_OPEN in the file: open
      qualify: { enabled: false, minutes: 5, canJoin: true }, // no [QUALIFY]: off, default values
      race: { enabled: true, laps: 10, join: 1 },
    },
    sunAngle: 48,
  });
  assert.deepEqual(cfg?.ports, { http: 8081, tcp: 9600, udp: 9600 });
});

test("no [RACE] section means the race is off; no entry list spreads MAX_CLIENTS over CARS", async () => {
  const file = path.join(dir, "cfg", "server_cfg.ini");
  await writeFile(file, (await readFile(file, "utf8")).replace(/\[RACE\][\s\S]*$/, ""));
  await rm(path.join(dir, "cfg", "entry_list.ini"));
  const cfg = await readServerCfg(dir);
  assert.equal(cfg?.settings.sessions.race.enabled, false);
  assert.deepEqual(cfg?.settings.entries, [
    { car: "ks_mazda_miata", skin: "", count: 2 },
    { car: "ks_toyota_ae86_drift", skin: "", count: 2 },
  ]);
});

const good: AcSettingsInput = {
  name: "Nürburgring night",
  password: "",
  track: "ks_nordschleife",
  layout: "endurance",
  cspVersion: null,
  cspExtra: "",
  entries: [
    { car: "ks_mazda_miata", skin: "red", count: 2 },
    { car: "ks_mazda_miata", skin: "", count: 2 },
    { car: "wdts_nissan_silvia_s15", skin: "", count: 1 },
  ],
  damage: 0,
  tyreWear: 35,
  sessions: {
    practice: { enabled: true, minutes: 20, canJoin: true },
    qualify: { enabled: true, minutes: 10, canJoin: false },
    race: { enabled: true, laps: 7, join: 2 },
  },
  trackTemp: 6,
  airTemp: 18,
  startTime: "09:30",
};

test("validation rejects unknown content, too many slots, bad numbers and line breaks", async () => {
  const content = await scanContent(dir);
  const ok = validateSettings(good, content);
  assert.ok(ok.ok);
  assert.equal(ok.settings.sunAngle, -56); // 16 * (9.5h - 13h)

  const bad = (patch: Partial<AcSettingsInput>) => {
    const r = validateSettings({ ...good, ...patch }, content);
    return r.ok ? {} : r.errors;
  };
  assert.ok(bad({ track: "../../etc" }).track);
  assert.ok(bad({ layout: "" }).layout); // Nordschleife has no default layout
  assert.ok(bad({ entries: [{ car: "not_a_car", skin: "", count: 1 }] }).entries);
  assert.ok(bad({ entries: [] }).entries);
  assert.ok(bad({ entries: [{ car: "ks_mazda_miata", skin: "../x", count: 1 }] }).entries);
  assert.match(bad({ entries: [{ car: "ks_mazda_miata", skin: "", count: 49 }] }).entries ?? "", /48 pit boxes/);
  assert.ok(bad({ damage: 101 }).damage);
  assert.ok(bad({ tyreWear: -1 }).tyreWear);
  const off = { enabled: false, minutes: 5, canJoin: true };
  assert.match(bad({ sessions: { practice: off, qualify: off, race: { enabled: false, laps: 5, join: 1 } } }).sessions ?? "", /at least one event/);
  assert.match(bad({ sessions: { ...good.sessions, practice: { enabled: true, minutes: 0, canJoin: true } } }).sessions ?? "", /Practice/);
  assert.match(bad({ sessions: { ...good.sessions, race: { enabled: true, laps: 2.5, join: 1 } } }).sessions ?? "", /Race/);
  // A switched-off event isn't checked (its boxes are greyed out).
  assert.equal(bad({ sessions: { ...good.sessions, qualify: { enabled: false, minutes: 0, canJoin: true } } }).sessions, undefined);
  assert.ok(bad({ startTime: "25:00" }).startTime);
  assert.ok(bad({ airTemp: Number.NaN }).airTemp);
  assert.ok(bad({ airTemp: 51 }).airTemp);
  assert.ok(bad({ trackTemp: 31 }).trackTemp);
  assert.ok(bad({ trackTemp: 2.5 }).trackTemp);
  assert.equal(bad({ airTemp: -5, trackTemp: -2 }).airTemp, undefined);
  assert.ok(bad({ startTime: "2pm" }).startTime);
  assert.ok(bad({ name: "a\r\nTRACK=x" }).name);
  assert.ok(bad({ password: "a;b" }).password);
});

test("applying settings edits only the managed keys and keeps comments, other sections and CRLF", async () => {
  const content = await scanContent(dir);
  const before = await readFile(path.join(dir, "cfg", "server_cfg.ini"), "utf8");
  const v = validateSettings(good, content);
  assert.ok(v.ok);
  const result = await writeSettings(dir, v.settings, content);
  const after = await readFile(path.join(dir, "cfg", "server_cfg.ini"), "utf8");

  assert.equal(result.entryListRewritten, true);
  assert.match(after, /\r\nTRACK=ks_nordschleife\r\n/);
  assert.match(after, /\r\nCONFIG_TRACK=endurance\r\n/);
  assert.match(after, /\r\nCARS=ks_mazda_miata;wdts_nissan_silvia_s15\r\n/);
  assert.match(after, /\r\nMAX_CLIENTS=5\r\n/);
  assert.match(after, /; keep this comment\r\nSUN_ANGLE=-56\r\n/);
  assert.match(after, /\r\nDAMAGE_MULTIPLIER=0\r\n/);
  assert.match(after, /\r\nTYRE_WEAR_RATE=35\r\n\r\n\[PRACTICE\]/); // added at the end of [SERVER]
  assert.match(after, /\[PRACTICE\]\r\nNAME=Practice\r\nTIME=20\r\nIS_OPEN=1\r\n/);
  assert.match(after, /\[WEATHER_0\]\r\nGRAPHICS=3_clear\r\nBASE_TEMPERATURE_AMBIENT=18\r\nBASE_TEMPERATURE_ROAD=6\r\n/);
  assert.doesNotMatch(after, /\[SERVER\][^[]*BASE_TEMPERATURE/); // never written into [SERVER]
  // Qualify didn't exist: added before the race. The race keeps its WAIT_TIME, runs by laps (TIME=0)
  // and is joinable until the start (IS_OPEN=2).
  assert.match(
    after,
    /BASE_TEMPERATURE_ROAD=6\r\n\r\n\[QUALIFY\]\r\nNAME=Qualify\r\nTIME=10\r\nIS_OPEN=0\r\n\r\n\[RACE\]\r\nNAME=Race\r\nLAPS=7\r\nWAIT_TIME=60\r\nTIME=0\r\nIS_OPEN=2\r\n$/,
  );
  assert.equal(await readFile(path.join(dir, "cfg", "server_cfg.ini.bak"), "utf8"), before);

  const slots = parseEntryList(await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8"));
  assert.deepEqual(slots.map((s) => `${s.model}/${s.skin}`), [
    "ks_mazda_miata/red",
    "ks_mazda_miata/red",
    "ks_mazda_miata/blue", // automatic rows cycle blue, red, white…
    "ks_mazda_miata/red",
    "wdts_nissan_silvia_s15/", // no known skins: default skin
  ]);
});

test("switching events off removes their sections; switching them on adds them back in order", async () => {
  const file = path.join(dir, "cfg", "server_cfg.ini");
  const content = await scanContent(dir);
  const save = async (sessions: Sessions) => {
    const v = validateSettings({ ...good, sessions }, content);
    assert.ok(v.ok);
    await writeSettings(dir, v.settings, content);
    return readFile(file, "utf8");
  };

  // Only qualify: practice and race disappear, everything else stays.
  const qualifyOnly = await save({
    practice: { enabled: false, minutes: 20, canJoin: true },
    qualify: { enabled: true, minutes: 8, canJoin: true },
    race: { enabled: false, laps: 7, join: 1 },
  });
  assert.doesNotMatch(qualifyOnly, /PRACTICE|\[RACE\]|LAPS|WAIT_TIME/);
  assert.match(qualifyOnly, /\[WEATHER_0\]\r\nGRAPHICS=3_clear\r\n/);
  assert.match(qualifyOnly, /\r\n\r\n\[QUALIFY\]\r\nNAME=Qualify\r\nTIME=8\r\nIS_OPEN=1\r\n$/);
  assert.doesNotMatch(qualifyOnly, /\r\n\r\n\r\n/); // no gaps left behind

  // All three again: practice goes before qualify, the race after it with the default WAIT_TIME.
  const all = await save({
    practice: { enabled: true, minutes: 15, canJoin: false },
    qualify: { enabled: true, minutes: 8, canJoin: true },
    race: { enabled: true, laps: 12, join: 1 },
  });
  assert.match(
    all,
    /\[PRACTICE\]\r\nNAME=Practice\r\nTIME=15\r\nIS_OPEN=0\r\n\r\n\[QUALIFY\]\r\nNAME=Qualify\r\nTIME=8\r\nIS_OPEN=1\r\n\r\n\[RACE\]\r\nNAME=Race\r\nTIME=0\r\nIS_OPEN=1\r\nWAIT_TIME=15\r\nLAPS=12\r\n$/,
  );
  const cfg = await readServerCfg(dir);
  assert.deepEqual(cfg?.settings.sessions, {
    practice: { enabled: true, minutes: 15, canJoin: false },
    qualify: { enabled: true, minutes: 8, canJoin: true },
    race: { enabled: true, laps: 12, join: 1 },
  });
});

test("a switched-off event shows its remembered values", async () => {
  const file = path.join(dir, "cfg", "server_cfg.ini");
  await writeFile(file, (await readFile(file, "utf8")).replace(/\[PRACTICE\]\r\nNAME=Practice\r\nTIME=60\r\n\r\n/, ""));
  const remembered: Sessions = {
    practice: { enabled: true, minutes: 45, canJoin: false },
    qualify: { enabled: false, minutes: 12, canJoin: true },
    race: { enabled: true, laps: 3, join: 2 },
  };
  const cfg = await readServerCfg(dir, remembered);
  assert.deepEqual(cfg?.settings.sessions.practice, { enabled: false, minutes: 45, canJoin: false });
  assert.deepEqual(cfg?.settings.sessions.qualify, { enabled: false, minutes: 12, canJoin: true });
  assert.deepEqual(cfg?.settings.sessions.race, { enabled: true, laps: 10, join: 1 }); // in the file: the file wins
});

test("an unchanged grid keeps the hand-made entry list (AI slots etc.) when the track changes", async () => {
  const content = await scanContent(dir);
  const original = await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8");
  const cfg = await readServerCfg(dir);
  const result = await writeSettings(dir, { ...cfg!.settings, track: "ks_vallelunga_club" }, content);
  assert.equal(result.entryListRewritten, false);
  assert.equal(await readFile(path.join(dir, "cfg", "entry_list.ini"), "utf8"), original);
});

test("grid rows: matching an existing entry list", () => {
  const existing: Slot[] = [
    { model: "a", skin: "red" },
    { model: "b", skin: "x" },
    { model: "a", skin: "blue" },
  ];
  assert.ok(slotsSatisfy(existing, [{ car: "a", skin: "", count: 2 }, { car: "b", skin: "", count: 1 }]));
  assert.ok(slotsSatisfy(existing, [{ car: "a", skin: "blue", count: 1 }, { car: "a", skin: "", count: 1 }, { car: "b", skin: "x", count: 1 }]));
  assert.ok(!slotsSatisfy(existing, [{ car: "a", skin: "red", count: 2 }, { car: "b", skin: "", count: 1 }]));
  assert.ok(!slotsSatisfy(existing, [{ car: "a", skin: "", count: 3 }]));
  assert.ok(!slotsSatisfy(existing, [{ car: "a", skin: "", count: 2 }, { car: "c", skin: "", count: 1 }]));
});

test("start time ⇄ SUN_ANGLE uses AssettoServer's formula (13:00 = 0°, 16° per hour)", () => {
  const angle = (t: string) => sunAngleFromSeconds(parseTime(t)!);
  assert.equal(angle("13:00"), 0);
  assert.equal(angle("08:00"), -80);
  assert.equal(angle("18:00"), 80);
  assert.equal(angle("14:30"), 24);
  assert.equal(angle("00:00"), -208);
  assert.equal(angle("23:59"), 175); // clamped so it doesn't round to the next midnight
  assert.equal(formatTime(secondsFromSunAngle(21)), "14:19"); // whole degrees = 3¾-minute steps
  assert.equal(formatTime(secondsFromSunAngle(48)), "16:00");
  assert.equal(parseTime("7:05"), 7 * 3600 + 5 * 60);
  assert.equal(parseTime("24:00"), null);
});

test("entry list cycles through each car's skins, continuing across rows", async () => {
  const { cars } = await scanContent(dir);
  const skinsOf = (id: string) => cars.find((c) => c.id === id)?.skins ?? [];
  const slots = slotsFor([{ car: "ks_mazda_miata", skin: "", count: 2 }, { car: "ks_mazda_miata", skin: "", count: 2 }], skinsOf);
  assert.deepEqual(slots.map((s) => s.skin), ["blue", "red", "white", "blue"]);
  assert.match(buildEntryList(slots), /^\[CAR_0\]\nMODEL=ks_mazda_miata\nSKIN=blue\n/);
});

test("reads connected players from AssettoServer's /api/details", () => {
  const info = parseDetails({
    MaxClients: 12,
    Players: {
      Cars: [
        { Model: "ks_mazda_miata", DriverName: "Alex", IsConnected: true },
        { Model: "ks_mazda_miata", DriverName: "", IsConnected: false },
      ],
    },
  });
  assert.deepEqual(info, { players: [{ name: "Alex", car: "ks_mazda_miata" }], maxPlayers: 12 });
});
