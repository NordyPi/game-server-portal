import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDir, type Instance } from "@/lib/config";
import { byName, CONTENT_ID, prettify, scanContent, trackName, type Car, type Content, type Track } from "./content";
import { parseEntryList, type Slot } from "./entries";

// Cars and tracks added by hand on the "Cars & tracks" page.
//
// The server doesn't need a mod's files to host it: only the folder name has to be in the config,
// and every player needs the mod installed. So when friends install a new mod, they just tell
// the portal its folder name (and layouts). These entries are stored per server in
// data/catalog-<instance id>.json and combined with whatever is found in the server's content/.
// When both exist, the hand-typed display name and pit-box count win.

const idSchema = z.string().trim().regex(CONTENT_ID, "Use the exact folder name: letters, digits, _ . - and spaces only.");
const nameSchema = z.string().trim().max(100);
const pitboxesSchema = z.number().int().min(1).max(128).nullable();

/** Skin folder names from content/cars/<car>/skins/ on a player's PC. Optional: a car can have none listed. */
const manualCarSchema = z.object({
  id: idSchema,
  name: nameSchema,
  skins: z.array(z.string().trim().regex(CONTENT_ID, "Skin names are folder names: letters, digits, _ . - and spaces only.")).default([]),
});
const manualLayoutSchema = z.object({ id: z.union([z.literal(""), idSchema]), name: nameSchema, pitboxes: pitboxesSchema });
const manualTrackSchema = z.object({ id: idSchema, name: nameSchema, layouts: z.array(manualLayoutSchema).min(1) });
const catalogSchema = z.object({
  cars: z.array(manualCarSchema).default([]),
  tracks: z.array(manualTrackSchema).default([]),
});

export type ManualCar = z.infer<typeof manualCarSchema>;
export type ManualLayout = z.infer<typeof manualLayoutSchema>;
export type ManualTrack = z.infer<typeof manualTrackSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export { manualCarSchema, manualTrackSchema };

/**
 * Adds an entry, or replaces the one with the same folder name. When editing, `originalId` is the
 * folder name it had before: the entry keeps its place in the list and may get a new folder name
 * (to fix a typo), unless another entry already has that name.
 */
export function putEntry<T extends { id: string }>(
  list: T[],
  entry: T,
  originalId?: string,
): { ok: true; list: T[]; replaced: boolean } | { ok: false; error: string } {
  const from = originalId || entry.id;
  if (from !== entry.id && list.some((x) => x.id === entry.id)) {
    return { ok: false, error: `“${entry.id}” is already in the list. Edit that one instead.` };
  }
  const at = list.findIndex((x) => x.id === from);
  if (at < 0) return { ok: true, list: [...list, entry], replaced: false };
  return { ok: true, list: list.map((x, i) => (i === at ? entry : x)), replaced: true };
}

export function catalogFile(instanceId: string) {
  return path.join(dataDir(), `catalog-${instanceId}.json`);
}

export async function loadCatalog(file: string): Promise<Catalog> {
  try {
    return catalogSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { cars: [], tracks: [] };
    throw new Error(`${file} is damaged: ${err instanceof Error ? err.message : err}`);
  }
}

export async function saveCatalog(file: string, catalog: Catalog) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

/** Everything the settings page can offer: what's on the server plus what was added by hand. */
export async function getContent(instance: Instance): Promise<Content> {
  const [scanned, catalog, entryList] = await Promise.all([
    scanContent(instance.dir),
    loadCatalog(catalogFile(instance.id)),
    readFile(path.join(instance.dir, "cfg", "entry_list.ini"), "utf8").catch(() => ""),
  ]);
  return withEntryListSkins(mergeContent(scanned, catalog), parseEntryList(entryList));
}

/**
 * Skins the current entry list already uses count as known skins too, so they stay pickable
 * even when the server has no skins/ folders (Content Manager server packs leave them out).
 */
export function withEntryListSkins(content: Content, slots: Slot[]): Content {
  const used = new Map<string, Set<string>>();
  for (const s of slots) if (s.skin && CONTENT_ID.test(s.skin)) used.set(s.model, (used.get(s.model) ?? new Set()).add(s.skin));
  return {
    ...content,
    cars: content.cars.map((c) => (used.has(c.id) ? { ...c, skins: [...new Set([...c.skins, ...used.get(c.id)!])].sort() } : c)),
  };
}

export type InUseMissing = { cars: { id: string; skins: string[] }[]; track: { id: string; layout: string } | null };

/**
 * Cars and the track the server is set up with right now that aren't in the lists yet. The
 * "Cars & tracks" page offers to add them in one click, so an existing setup works straight away.
 */
export function missingFromLists(
  current: { track: string; layout: string; cars: string[] },
  slots: Slot[],
  content: Content,
): InUseMissing {
  const known = new Set(content.cars.map((c) => c.id));
  const ids = [...new Set([...current.cars, ...slots.map((s) => s.model)])].filter((id) => CONTENT_ID.test(id) && !known.has(id));
  const cars = ids.map((id) => ({
    id,
    skins: [...new Set(slots.filter((s) => s.model === id && s.skin && CONTENT_ID.test(s.skin)).map((s) => s.skin))].sort(),
  }));

  const track = content.tracks.find((t) => t.id === current.track);
  const trackMissing =
    current.track && CONTENT_ID.test(current.track) && (current.layout === "" || CONTENT_ID.test(current.layout)) &&
    !track?.layouts.some((l) => l.id === current.layout);
  return { cars, track: trackMissing ? { id: current.track, layout: current.layout } : null };
}

/** Adds what missingFromLists() found to a catalog (keeping anything already in it). */
export function addMissingToCatalog(catalog: Catalog, missing: InUseMissing): Catalog {
  const cars = [...catalog.cars];
  for (const m of missing.cars) {
    const i = cars.findIndex((c) => c.id === m.id);
    if (i >= 0) cars[i] = { ...cars[i], skins: [...new Set([...cars[i].skins, ...m.skins])].sort() };
    else cars.push({ id: m.id, name: "", skins: m.skins });
  }
  const tracks = [...catalog.tracks];
  if (missing.track) {
    const { id, layout } = missing.track;
    const i = tracks.findIndex((t) => t.id === id);
    const newLayout = { id: layout, name: "", pitboxes: null };
    if (i < 0) tracks.push({ id, name: "", layouts: [newLayout] });
    else if (!tracks[i].layouts.some((l) => l.id === layout)) tracks[i] = { ...tracks[i], layouts: [...tracks[i].layouts, newLayout] };
  }
  return { cars, tracks };
}

export function mergeContent(scanned: Content, catalog: Catalog): Content {
  const cars = new Map<string, Car>(scanned.cars.map((c) => [c.id, c]));
  for (const m of catalog.cars) {
    const found = cars.get(m.id);
    cars.set(
      m.id,
      found
        ? { ...found, name: m.name || found.name, skins: [...new Set([...found.skins, ...m.skins])].sort(), manual: true }
        : { id: m.id, name: m.name || prettify(m.id), brand: "", skins: [...new Set(m.skins)].sort(), onServer: false, manual: true },
    );
  }

  const tracks = new Map<string, Track>(scanned.tracks.map((t) => [t.id, t]));
  for (const m of catalog.tracks) {
    const found = tracks.get(m.id);
    const layouts = new Map((found?.layouts ?? []).map((l) => [l.id, l]));
    for (const ml of m.layouts) {
      const fl = layouts.get(ml.id);
      layouts.set(ml.id, {
        id: ml.id,
        name: ml.name || fl?.name || (ml.id ? prettify(ml.id) : "Default"),
        pitboxes: ml.pitboxes ?? fl?.pitboxes ?? null,
        onServer: fl?.onServer ?? false,
        manual: true,
      });
    }
    const merged = [...layouts.values()].sort(byName);
    tracks.set(m.id, {
      id: m.id,
      name: m.name || found?.name || trackName(m.id, merged),
      layouts: merged,
      onServer: found?.onServer ?? false,
      manual: true,
    });
  }

  return { cars: [...cars.values()].sort(byName), tracks: [...tracks.values()].sort(byName) };
}
