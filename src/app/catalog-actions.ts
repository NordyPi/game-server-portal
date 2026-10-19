"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { getInstance } from "@/lib/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addMissingToCatalog,
  catalogFile,
  getContent,
  loadCatalog,
  missingFromLists,
  manualCarSchema,
  manualTrackSchema,
  saveCatalog,
  type Catalog,
  type ManualLayout,
} from "@/lib/games/assetto-corsa/catalog";
import { parseEntryList } from "@/lib/games/assetto-corsa/entries";
import { readServerCfg } from "@/lib/games/assetto-corsa/server-config";
import { withInstanceLock } from "@/lib/locks";
import { requireUser } from "@/lib/session";

// Adding/removing hand-made car and track entries (see src/lib/games/assetto-corsa/catalog.ts).
// Nothing here touches the game server; the new options just show up in the settings form.

export type CatalogResult = { ok: boolean; message: string; errors: Record<string, string> };

const fail = (message: string, errors: Record<string, string> = {}): CatalogResult => ({ ok: false, message, errors });

async function updateCatalog(instanceId: string, change: (catalog: Catalog) => void) {
  const file = catalogFile(instanceId);
  await withInstanceLock(`catalog:${instanceId}`, async () => {
    const catalog = await loadCatalog(file);
    change(catalog);
    await saveCatalog(file, catalog);
  });
  revalidatePath("/", "layout");
}

export async function addCatalogCar(instanceId: string, form: FormData): Promise<CatalogResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return fail("Unknown server.");

  const skins = form.getAll("skin").map((s) => String(s).trim()).filter(Boolean);
  if (new Set(skins).size !== skins.length) return fail("Each skin can only be listed once.", { skins: "Duplicate skin name." });
  const parsed = manualCarSchema.safeParse({ id: form.get("id") ?? "", name: form.get("name") ?? "", skins });
  if (!parsed.success) return fail("Check the car's folder name.", fieldErrors(parsed.error));
  const car = parsed.data;

  let replaced = false;
  await updateCatalog(instance.id, (c) => {
    replaced = c.cars.some((x) => x.id === car.id);
    c.cars = [...c.cars.filter((x) => x.id !== car.id), car];
  });
  await logActivity({ instanceId: instance.id, user: user.name, message: `${replaced ? "updated" : "added"} car ${car.name || car.id}` });
  return { ok: true, message: `${car.name || car.id} ${replaced ? "updated" : "added"}. It's now in the car list.`, errors: {} };
}

export async function addCatalogTrack(instanceId: string, form: FormData): Promise<CatalogResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return fail("Unknown server.");

  const pitboxes = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : Number(s);
  };
  const ids = form.getAll("layoutId").map((v) => String(v).trim());
  const names = form.getAll("layoutName").map(String);
  const pits = form.getAll("layoutPitboxes");
  let layouts: ManualLayout[] = ids
    .map((id, i) => ({ id, name: names[i] ?? "", pitboxes: pitboxes(pits[i]) }))
    .filter((l) => l.id !== "");
  // No layout rows: a single-layout track (CONFIG_TRACK stays empty).
  if (layouts.length === 0) layouts = [{ id: "", name: "", pitboxes: pitboxes(form.get("pitboxes")) }];

  if (new Set(layouts.map((l) => l.id)).size !== layouts.length) return fail("Each layout folder can only be listed once.", { layouts: "Duplicate layout folder." });

  const parsed = manualTrackSchema.safeParse({ id: form.get("id") ?? "", name: form.get("name") ?? "", layouts });
  if (!parsed.success) return fail("Fix the fields marked in red.", fieldErrors(parsed.error));
  const track = parsed.data;

  let replaced = false;
  await updateCatalog(instance.id, (c) => {
    replaced = c.tracks.some((x) => x.id === track.id);
    c.tracks = [...c.tracks.filter((x) => x.id !== track.id), track];
  });
  const layoutText = track.layouts.length > 1 ? ` (${track.layouts.length} layouts)` : "";
  await logActivity({ instanceId: instance.id, user: user.name, message: `${replaced ? "updated" : "added"} track ${track.name || track.id}${layoutText}` });
  return { ok: true, message: `${track.name || track.id} ${replaced ? "updated" : "added"}. It's now in the track list.`, errors: {} };
}

export async function removeCatalogEntry(instanceId: string, kind: "car" | "track", id: string): Promise<CatalogResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa" || (kind !== "car" && kind !== "track")) return fail("Unknown server.");

  let removed = "";
  await updateCatalog(instance.id, (c) => {
    if (kind === "car") {
      removed = c.cars.find((x) => x.id === id)?.name || id;
      c.cars = c.cars.filter((x) => x.id !== id);
    } else {
      removed = c.tracks.find((x) => x.id === id)?.name || id;
      c.tracks = c.tracks.filter((x) => x.id !== id);
    }
  });
  await logActivity({ instanceId: instance.id, user: user.name, message: `removed ${kind} ${removed} from the list` });
  return { ok: true, message: "Removed.", errors: {} };
}

/** Zod issues → { field: message }, e.g. { id: "…", "layouts.1.pitboxes": "…" } collapsed to the top-level field. */
function fieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const [field, , sub] = issue.path.map(String);
    const key = field === "layouts" && sub === "pitboxes" ? "pitboxes" : field;
    out[key] ??= key === "pitboxes" ? "Pit boxes must be a whole number from 1 to 128." : issue.message;
  }
  return out;
}

/** Adds the cars and track the server currently uses (but the lists don't know yet) in one go. */
export async function addInUseToCatalog(instanceId: string): Promise<CatalogResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return fail("Unknown server.");

  const cfg = await readServerCfg(instance.dir);
  if (!cfg) return fail("cfg/server_cfg.ini is missing on the server.");
  const slots = parseEntryList(await readFile(path.join(instance.dir, "cfg", "entry_list.ini"), "utf8").catch(() => ""));
  const missing = missingFromLists({ ...cfg.settings, cars: cfg.cars }, slots, await getContent(instance));
  const count = missing.cars.length + (missing.track ? 1 : 0);
  if (count === 0) return { ok: true, message: "Everything the server uses is already in the lists.", errors: {} };

  await updateCatalog(instance.id, (c) => {
    const merged = addMissingToCatalog(c, missing);
    c.cars = merged.cars;
    c.tracks = merged.tracks;
  });
  const parts = [missing.cars.length ? `${missing.cars.length} car${missing.cars.length === 1 ? "" : "s"}` : "", missing.track ? `track ${missing.track.id}` : ""].filter(Boolean);
  await logActivity({ instanceId: instance.id, user: user.name, message: `added the server's current ${parts.join(" and ")} to the lists` });
  return { ok: true, message: `Added ${parts.join(" and ")}. To give one a nicer name, add it again above with the same folder name.`, errors: {} };
}
