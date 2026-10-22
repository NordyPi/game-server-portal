import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { IniFile } from "@/lib/ini";
import { CONTENT_ID, type Content } from "./content";
import { buildEntryList, carsOf, parseEntryList, rowsFromSlots, slotsFor, slotsSatisfy, totalSlots, type EntryRow } from "./entries";
import { ensureMissingContentAllowed } from "./extra-config";
import { readSessions, validateSessions, writeSessions, type Sessions } from "./sessions";
import { formatTime, parseTime, secondsFromSunAngle, sunAngleFromSeconds } from "./sun";
import { formatTrackSetting, parseTrackSetting } from "./track-setting";

// Reads and writes the two files that decide what the server runs:
//   cfg/server_cfg.ini   [SERVER] NAME, PASSWORD, TRACK, CONFIG_TRACK, CARS, MAX_CLIENTS,
//                        DAMAGE_MULTIPLIER, TYRE_WEAR_RATE, SUN_ANGLE, [WEATHER_0] temperatures, and the
//                        [PRACTICE] / [QUALIFY] / [RACE] events (see sessions.ts)
//                        (everything else is left untouched)
//   cfg/entry_list.ini   one [CAR_n] section per grid slot (see entries.ts)
// In extra_cfg.yml (AssettoServer's own settings) only two "ignore missing content" flags are set; see extra-config.ts.

export type AcSettings = {
  name: string;
  password: string;
  /** Track folder name, without any CSP requirement (see track-setting.ts). */
  track: string;
  layout: string;
  /** Minimum Custom Shaders Patch build players need, or null for none. */
  cspVersion: number | null;
  /** Content Manager's extra TRACK segments, kept as they were (e.g. "D/../"). */
  cspExtra: string;
  /** The grid. CARS and MAX_CLIENTS are derived from it. */
  entries: EntryRow[];
  /** Percent, 0 = no damage. */
  damage: number;
  /**
   * [WEATHER_0] BASE_TEMPERATURE_ROAD: degrees the track is *above* the air, not a temperature
   * of its own (AssettoServer: road = ambient + this).
   */
  trackTemp: number;
  /** [WEATHER_0] BASE_TEMPERATURE_AMBIENT, °C. */
  airTemp: number;
  /** Percent, 0 = tyres never wear. */
  tyreWear: number;
  /** Practice, qualify and race: on/off, duration or laps, who can join. */
  sessions: Sessions;
  /** Time of day the server starts at; see sun.ts. */
  sunAngle: number;
};

/** What the form sends: the start time as "HH:MM" instead of an angle. */
export type AcSettingsInput = Omit<AcSettings, "sunAngle"> & { startTime: string };

export type AcPorts = { http: number | null; tcp: number | null; udp: number | null };

export const MAX_SLOTS = 128;

const cfgPath = (dir: string, file: string) => path.join(dir, "cfg", file);

/** `rememberedSessions`: last values of switched-off events (session-memory.ts), shown in their boxes. */
export async function readServerCfg(
  dir: string,
  rememberedSessions?: Sessions,
): Promise<{ settings: AcSettings; ports: AcPorts; cars: string[] } | null> {
  let ini: IniFile;
  try {
    ini = new IniFile(await readFile(cfgPath(dir, "server_cfg.ini"), "utf8"));
  } catch {
    return null;
  }
  const get = (k: string, section = "SERVER") => ini.get(section, k) ?? "";
  const int = (k: string, section = "SERVER") => (/^-?\d+(\.\d+)?$/.test(get(k, section)) ? Math.round(Number(get(k, section))) : null);

  const trackSetting = parseTrackSetting(get("TRACK"));
  const cars = get("CARS").split(";").map((c) => c.trim()).filter(Boolean);
  let entries = rowsFromSlots(parseEntryList(await readText(cfgPath(dir, "entry_list.ini"))));
  if (entries.length === 0 && cars.length) {
    // No entry list yet: spread MAX_CLIENTS over CARS.
    const slots = Math.max(int("MAX_CLIENTS") ?? cars.length, cars.length);
    entries = cars.map((car, i) => ({ car, skin: "", count: Math.floor(slots / cars.length) + (i < slots % cars.length ? 1 : 0) }));
  }

  return {
    settings: {
      name: get("NAME"),
      password: get("PASSWORD"),
      track: trackSetting.track,
      layout: get("CONFIG_TRACK"),
      cspVersion: trackSetting.cspVersion,
      cspExtra: trackSetting.cspExtra,
      entries,
      damage: int("DAMAGE_MULTIPLIER") ?? 100,
      trackTemp: int("BASE_TEMPERATURE_ROAD", "WEATHER_0") ?? 6,
      airTemp: int("BASE_TEMPERATURE_AMBIENT", "WEATHER_0") ?? 18,
      tyreWear: int("TYRE_WEAR_RATE") ?? 100,
      sessions: readSessions(ini, rememberedSessions),
      sunAngle: int("SUN_ANGLE") ?? 0,
    },
    ports: { http: int("HTTP_PORT"), tcp: int("TCP_PORT"), udp: int("UDP_PORT") },
    /** CARS= as written (can list more cars than the entry list uses). */
    cars,
  };
}

export type ValidationErrors = Partial<Record<keyof AcSettingsInput, string>>;

/** Checks settings against what's actually installed. Returns cleaned settings or field errors. */
export function validateSettings(
  input: AcSettingsInput,
  content: Content,
): { ok: true; settings: AcSettings } | { ok: false; errors: ValidationErrors } {
  const errors: ValidationErrors = {};
  const name = input.name.trim();
  const password = input.password.trim();

  if (!name) errors.name = "Give the server a name.";
  else if (name.length > 100 || /[\r\n]/.test(name)) errors.name = "Keep it to one line, up to 100 characters.";
  if (password.length > 50 || /[\r\n;]/.test(password)) errors.password = "Up to 50 characters, no semicolons.";

  const track = content.tracks.find((t) => t.id === input.track);
  const layout = track?.layouts.find((l) => l.id === input.layout);
  if (!track) errors.track = "Pick a track from the list.";
  else if (!layout) errors.layout = "Pick a layout for this track.";

  const limit = Math.min(layout?.pitboxes ?? MAX_SLOTS, MAX_SLOTS);
  const total = totalSlots(input.entries);
  if (input.entries.length === 0) errors.entries = "Add at least one car to the grid.";
  else if (input.entries.some((r) => !Number.isInteger(r.count) || r.count < 1)) errors.entries = "Every car needs at least 1 slot.";
  else if (total > limit) {
    errors.entries = layout?.pitboxes
      ? `${total} slots, but this layout only has ${layout.pitboxes} pit boxes.`
      : `${total} slots is more than the ${MAX_SLOTS} the server allows.`;
  } else {
    for (const row of input.entries) {
      const car = content.cars.find((c) => c.id === row.car);
      if (!CONTENT_ID.test(row.car) || !car) {
        errors.entries = `“${row.car}” isn't in the car list any more. Remove it or add it on the Cars & tracks page.`;
        break;
      }
      // Any plain folder name is fine: the server may not know every skin players have installed.
      if (row.skin && !CONTENT_ID.test(row.skin)) {
        errors.entries = `“${row.skin}” isn't a valid skin folder name.`;
        break;
      }
    }
  }

  const percent = (v: number) => Number.isInteger(v) && v >= 0 && v <= 100;
  if (!percent(input.damage)) errors.damage = "0 to 100.";
  if (!percent(input.tyreWear)) errors.tyreWear = "0 to 100.";
  const between = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!between(input.airTemp, -20, 50)) errors.airTemp = "A whole number from -20 to 50 °C.";
  if (!between(input.trackTemp, -10, 30)) errors.trackTemp = "A whole number from -10 to 30.";
  const sessionError = validateSessions(input.sessions);
  if (sessionError) errors.sessions = sessionError;
  if (input.cspVersion !== null && (!Number.isInteger(input.cspVersion) || input.cspVersion < 1 || input.cspVersion > 99999)) {
    errors.cspVersion = "A CSP build number like 4116, or leave it empty.";
  }
  if (!/^(?:[A-Za-z0-9_]+\/\.\.\/)*$/.test(input.cspExtra)) errors.cspVersion = "The server's CSP setting looks unusual; reload the page.";
  const seconds = parseTime(input.startTime);
  if (seconds === null) errors.startTime = "Use 24-hour time, like 14:30.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      name,
      password,
      track: input.track,
      layout: input.layout,
      cspVersion: input.cspVersion,
      cspExtra: input.cspVersion === null ? "" : input.cspExtra,
      entries: input.entries,
      damage: input.damage,
      tyreWear: input.tyreWear,
      sessions: input.sessions,
      sunAngle: sunAngleFromSeconds(seconds!),
      trackTemp: input.trackTemp,
      airTemp: input.airTemp,
    },
  };
}

/** The time a sun angle actually starts at, e.g. 21 → "14:19" (angles are whole degrees). */
export function startTimeOf(sunAngle: number) {
  return formatTime(secondsFromSunAngle(sunAngle));
}

/**
 * Writes validated settings. The entry list is only regenerated when the grid really changes
 * (see slotsSatisfy), so hand-made tweaks to it survive a track change.
 * The previous version of each file is kept next to it as *.bak.
 */
export async function writeSettings(dir: string, settings: AcSettings, content: Content): Promise<{ entryListRewritten: boolean }> {
  // Cars added by hand have no files on the server; make sure AssettoServer still starts.
  await ensureMissingContentAllowed(dir);

  const serverCfgFile = cfgPath(dir, "server_cfg.ini");
  const ini = new IniFile(await readFile(serverCfgFile, "utf8"));
  ini.set("SERVER", "NAME", settings.name);
  ini.set("SERVER", "PASSWORD", settings.password);
  ini.set("SERVER", "TRACK", formatTrackSetting(settings));
  ini.set("SERVER", "CONFIG_TRACK", settings.layout);
  ini.set("SERVER", "CARS", carsOf(settings.entries).join(";"));
  ini.set("SERVER", "MAX_CLIENTS", String(totalSlots(settings.entries)));
  ini.set("SERVER", "DAMAGE_MULTIPLIER", String(settings.damage));
  ini.set("SERVER", "TYRE_WEAR_RATE", String(settings.tyreWear));
  ini.set("SERVER", "SUN_ANGLE", String(settings.sunAngle));
  // Only the first weather, and only if it exists: a [WEATHER_0] without GRAPHICS would break the server.
  if (ini.sections().includes("WEATHER_0")) {
    ini.set("WEATHER_0", "BASE_TEMPERATURE_ROAD", String(settings.trackTemp));
    ini.set("WEATHER_0", "BASE_TEMPERATURE_AMBIENT", String(settings.airTemp));
  }
  writeSessions(ini, settings.sessions);

  const entryListFile = cfgPath(dir, "entry_list.ini");
  const rewrite = !slotsSatisfy(parseEntryList(await readText(entryListFile)), settings.entries);

  await atomicWrite(serverCfgFile, ini.toString());
  if (rewrite) {
    const skinsOf = (id: string) => content.cars.find((c) => c.id === id)?.skins ?? [];
    await atomicWrite(entryListFile, buildEntryList(slotsFor(settings.entries, skinsOf)));
  }
  return { entryListRewritten: rewrite };
}

async function readText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function atomicWrite(file: string, text: string) {
  try {
    await copyFile(file, `${file}.bak`);
  } catch {
    // first write: nothing to back up
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}
