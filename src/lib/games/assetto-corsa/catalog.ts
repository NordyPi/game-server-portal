import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDir, type Instance } from "@/lib/config";
import { byName, CONTENT_ID, prettify, scanContent, trackName, type Car, type Content, type Track } from "./content";

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
  const [scanned, catalog] = await Promise.all([scanContent(instance.dir), loadCatalog(catalogFile(instance.id))]);
  return mergeContent(scanned, catalog);
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
