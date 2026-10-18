import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Finds the cars and tracks installed in an AssettoServer folder:
//
//   content/cars/<car>/                    data.acd (or data/), ui/ui_car.json, skins/<skin>/
//   content/tracks/<track>/data/           single-layout track (CONFIG_TRACK empty)
//   content/tracks/<track>/<layout>/data/  one folder per layout (CONFIG_TRACK=<layout>)
//   content/tracks/<track>/ui[/<layout>]/ui_track.json   display name and pit count
//
// The ui_*.json files are optional (server packs from Content Manager often leave them out); we
// fall back to folder names.

/** onServer: files found in content/. manual: added by hand on the "Cars & tracks" page (see catalog.ts). */
export type Source = { onServer: boolean; manual: boolean };
export type Car = { id: string; name: string; brand: string; skins: string[] } & Source;
export type TrackLayout = { id: string; name: string; pitboxes: number | null } & Source;
export type Track = { id: string; name: string; layouts: TrackLayout[] } & Source;
export type Content = { cars: Car[]; tracks: Track[] };

/** Folder names we accept as car/track/layout ids. They end up in INI files, so keep them plain. */
export const CONTENT_ID = /^[A-Za-z0-9_.\- ]{1,100}$/;

const onServer: Source = { onServer: true, manual: false };

export async function scanContent(serverDir: string): Promise<Content> {
  const [cars, tracks] = await Promise.all([
    scanCars(path.join(serverDir, "content", "cars")),
    scanTracks(path.join(serverDir, "content", "tracks")),
  ]);
  return { cars, tracks };
}

async function scanCars(dir: string): Promise<Car[]> {
  const cars = await Promise.all(
    (await subdirs(dir)).map(async (id): Promise<Car | null> => {
      const carDir = path.join(dir, id);
      if (!(await exists(path.join(carDir, "data.acd"))) && !(await isDir(path.join(carDir, "data")))) return null;
      const ui = await readUiJson(path.join(carDir, "ui", "ui_car.json"));
      return {
        id,
        name: ui.name || prettify(id),
        brand: ui.brand ?? "",
        skins: (await subdirs(path.join(carDir, "skins"))).sort(),
        ...onServer,
      };
    }),
  );
  return cars.filter((c): c is Car => c !== null).sort(byName);
}

async function scanTracks(dir: string): Promise<Track[]> {
  const tracks = await Promise.all(
    (await subdirs(dir)).map(async (id): Promise<Track | null> => {
      const trackDir = path.join(dir, id);
      const layouts: TrackLayout[] = [];

      if (await isDir(path.join(trackDir, "data"))) {
        const ui = await readUiJson(path.join(trackDir, "ui", "ui_track.json"));
        layouts.push({ id: "", name: ui.name || "Default", pitboxes: ui.pitboxes, ...onServer });
      }
      for (const sub of await subdirs(trackDir)) {
        if (sub === "data" || sub === "ui" || !(await isDir(path.join(trackDir, sub, "data")))) continue;
        const ui = await readUiJson(path.join(trackDir, "ui", sub, "ui_track.json"));
        layouts.push({ id: sub, name: ui.name || prettify(sub), pitboxes: ui.pitboxes, ...onServer });
      }
      if (layouts.length === 0) return null;
      layouts.sort(byName);

      return { id, name: trackName(id, layouts), layouts, ...onServer };
    }),
  );
  return tracks.filter((t): t is Track => t !== null).sort(byName);
}

/** Multi-layout tracks repeat the track name in every layout ("Nordschleife - Endurance"); use the common part. */
export function trackName(id: string, layouts: TrackLayout[]) {
  if (layouts.length === 1) return layouts[0].name === "Default" ? prettify(id) : layouts[0].name;
  const names = layouts.map((l) => l.name);
  let prefix = names[0];
  for (const n of names) while (prefix && !n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[\s\-–—:(]+$/, "").trim();
  return prefix.length >= 3 ? prefix : prettify(id);
}

type UiInfo = { name: string; brand?: string; pitboxes: number | null };

/**
 * ui_*.json files in mods are frequently not valid JSON (trailing commas, raw tabs/newlines in
 * strings, BOMs), so pull out the few fields we need with patterns instead of JSON.parse.
 */
export function parseUiJson(text: string): UiInfo {
  const str = (key: string) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (!m) return undefined;
    return m[1].replace(/\\(["\\/])/g, "$1").replace(/\\[ntr]/g, " ").replace(/\s+/g, " ").trim();
  };
  const pit = /"pitboxes"\s*:\s*"?(\d+)/.exec(text);
  return { name: str("name") ?? "", brand: str("brand"), pitboxes: pit ? Number(pit[1]) : null };
}

async function readUiJson(file: string): Promise<UiInfo> {
  try {
    return parseUiJson(await readFile(file, "utf8"));
  } catch {
    return { name: "", pitboxes: null };
  }
}

export function prettify(id: string) {
  return id
    .replace(/^ks_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && CONTENT_ID.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

async function isDir(p: string) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
