"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { getInstance } from "@/lib/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addMissingToCatalog,
  catalogFile,
  editedCarSkins,
  getContent,
  loadCatalog,
  missingFromLists,
  manualCarSchema,
  manualTrackSchema,
  putEntry,
  saveCatalog,
  type Catalog,
  type ManualLayout,
} from "@/lib/games/assetto-corsa/catalog";
import { CONTENT_ID, scanContent } from "@/lib/games/assetto-corsa/content";
import { parseEntryList } from "@/lib/games/assetto-corsa/entries";
import { loadPresets, presetsFile, renameCarInPresets, savePresets } from "@/lib/games/assetto-corsa/entry-presets";
import { readServerCfg } from "@/lib/games/assetto-corsa/server-config";
import { withInstanceLock } from "@/lib/locks";
import { requireUser } from "@/lib/session";

// Adding, editing and removing hand-made car and track entries (see src/lib/games/assetto-corsa/catalog.ts).
// Nothing here touches the game server; the options just change in the settings form.
//
// The same action adds and edits: an edit form also sends "originalId", the folder name the entry
// had when the form opened, so a mistyped folder name can be corrected.

export type CatalogResult = { ok: boolean; message: string; errors: Record<string, string> };

const fail = (message: string, errors: Record<string, string> = {}): CatalogResult => ({ ok: false, message, errors });

/** `change` may return an error message to cancel the save. */
async function updateCatalog(instanceId: string, change: (catalog: Catalog) => string | void): Promise<string | undefined> {
  const file = catalogFile(instanceId);
  const error = await withInstanceLock(`catalog:${instanceId}`, async () => {
    const catalog = await loadCatalog(file);
    const problem = change(catalog);
    if (problem) return problem;
    await saveCatalog(file, catalog);
  });
  if (!error) revalidatePath("/", "layout");
  return error ?? undefined;
}

/**
 * The folder name the edit form started from, if it's being changed. Folders that really exist on
 * the server can't be renamed here: their name is whatever the folder is called.
 */
async function renameCheck(dir: string, kind: "cars" | "tracks", originalId: string, newId: string): Promise<string | undefined> {
  if (!originalId || originalId === newId) return;
  const scanned = await scanContent(dir);
  if (scanned[kind].some((x) => x.id === originalId)) {
    return `“${originalId}” is a folder on the server, so its folder name can't be changed here.`;
  }
}

export async function saveCatalogCar(instanceId: string, form: FormData): Promise<CatalogResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return fail("Unknown server.");

  const skins = form.getAll("skin").map((s) => String(s).trim()).filter(Boolean);
  if (new Set(skins).size !== skins.length) return fail("Each skin can only be listed once.", { skins: "Duplicate skin name." });
  const parsed = manualCarSchema.safeParse({ id: form.get("id") ?? "", name: form.get("name") ?? "", skins });
  if (!parsed.success) return fail("Check the car's folder name.", fieldErrors(parsed.error));
  const car = parsed.data;
  const originalId = String(form.get("originalId") ?? "").trim();
  // The server's own skins the edit form showed; one whose row was removed gets hidden.
  const shownServerSkins = form.getAll("serverSkin").map(String).filter((s) => CONTENT_ID.test(s));

  const locked = await renameCheck(instance.dir, "cars", originalId, car.id);
  if (locked) return fail("Not saved.", { id: locked });

  let replaced = false;
  const error = await updateCatalog(instance.id, (c) => {
    const before = c.cars.find((x) => x.id === (originalId || car.id));
    const { skins, hiddenSkins } = editedCarSkins(car.skins, shownServerSkins, before?.hiddenSkins);
    const result = putEntry(c.cars, { id: car.id, name: car.name, skins, ...(hiddenSkins.length ? { hiddenSkins } : {}) }, originalId);
    if (!result.ok) return result.error;
    c.cars = result.list;
    replaced = result.replaced;
  });
  if (error) return fail("Not saved.", { id: error });

  const renamed = originalId && originalId !== car.id;
  const notes: string[] = [];
  if (renamed) {
    // Saved grids follow the corrected folder name.
    const file = presetsFile(instance.id);
    await withInstanceLock(`presets:${instance.id}`, async () => {
      const { presets, changed } = renameCarInPresets(await loadPresets(file), originalId, car.id);
      if (changed) {
        await savePresets(file, presets);
        notes.push(`Updated ${changed} saved grid${changed === 1 ? "" : "s"}.`);
      }
    });
    const cfg = await readServerCfg(instance.dir);
    if (cfg && (cfg.cars.includes(originalId) || cfg.settings.entries.some((r) => r.car === originalId))) {
      notes.push(`The server's current grid still uses “${originalId}”: pick the car again in the settings and save.`);
    }
  }

  const label = car.name || car.id;
  await logActivity({
    instanceId: instance.id,
    user: user.name,
    message: renamed ? `renamed car ${originalId} → ${car.id}` : `${replaced ? "edited" : "added"} car ${label}`,
  });
  return { ok: true, message: [`${label} ${replaced ? "saved" : "added to the car list"}.`, ...notes].join(" "), errors: {} };
}

export async function saveCatalogTrack(instanceId: string, form: FormData): Promise<CatalogResult> {
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
  // An empty layout folder only comes from an edit form's "(no sub-folder)" row: the track's default
  // layout next to named ones. New rows can't be left empty (the inputs are required).
  let layouts: ManualLayout[] = ids.map((id, i) => ({ id, name: names[i] ?? "", pitboxes: pitboxes(pits[i]) }));
  // No layout rows: a single-layout track (CONFIG_TRACK stays empty).
  if (layouts.length === 0) layouts = [{ id: "", name: "", pitboxes: pitboxes(form.get("pitboxes")) }];

  if (new Set(layouts.map((l) => l.id)).size !== layouts.length) return fail("Each layout folder can only be listed once.", { layouts: "Duplicate layout folder." });

  const parsed = manualTrackSchema.safeParse({ id: form.get("id") ?? "", name: form.get("name") ?? "", layouts });
  if (!parsed.success) return fail("Fix the fields marked in red.", fieldErrors(parsed.error));
  const track = parsed.data;
  const originalId = String(form.get("originalId") ?? "").trim();

  const locked = await renameCheck(instance.dir, "tracks", originalId, track.id);
  if (locked) return fail("Not saved.", { id: locked });

  let replaced = false;
  const error = await updateCatalog(instance.id, (c) => {
    const result = putEntry(c.tracks, track, originalId);
    if (!result.ok) return result.error;
    c.tracks = result.list;
    replaced = result.replaced;
  });
  if (error) return fail("Not saved.", { id: error });

  const renamed = originalId && originalId !== track.id;
  const notes: string[] = [];
  const cfg = await readServerCfg(instance.dir);
  if (cfg && renamed && cfg.settings.track === originalId) {
    notes.push(`The server is still set to “${originalId}”: pick the track again in the settings and save.`);
  } else if (cfg && cfg.settings.track === track.id && !track.layouts.some((l) => l.id === cfg.settings.layout)) {
    // Only matters when the track has no files on the server, i.e. this list is all there is.
    const scanned = await scanContent(instance.dir);
    if (!scanned.tracks.some((t) => t.id === track.id && t.layouts.some((l) => l.id === cfg.settings.layout))) {
      notes.push(`The server is still set to layout “${cfg.settings.layout || "(no sub-folder)"}”, which isn't in this list any more.`);
    }
  }

  const label = track.name || track.id;
  const layoutText = track.layouts.length > 1 ? ` (${track.layouts.length} layouts)` : "";
  await logActivity({
    instanceId: instance.id,
    user: user.name,
    message: renamed ? `renamed track ${originalId} → ${track.id}` : `${replaced ? "edited" : "added"} track ${label}${layoutText}`,
  });
  return { ok: true, message: [`${label} ${replaced ? "saved" : "added to the track list"}.`, ...notes].join(" "), errors: {} };
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
  return { ok: true, message: `Added ${parts.join(" and ")}. Use Edit in the lists below to give them nicer names.`, errors: {} };
}
