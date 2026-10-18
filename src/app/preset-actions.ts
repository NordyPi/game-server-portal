"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { getInstance } from "@/lib/config";
import { entryRowSchema, loadPresets, presetNameSchema, presetsFile, savePresets } from "@/lib/games/assetto-corsa/entry-presets";
import type { EntryRow } from "@/lib/games/assetto-corsa/entries";
import { withInstanceLock } from "@/lib/locks";
import { requireUser } from "@/lib/session";

// Saving/deleting entry list presets. Loading one happens in the browser (the form already has
// every preset); nothing here touches the game server.

export type PresetResult = { ok: boolean; message: string };

export async function saveEntryPreset(instanceId: string, name: string, entries: EntryRow[]): Promise<PresetResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return { ok: false, message: "Unknown server." };

  const parsedName = presetNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, message: parsedName.error.issues[0].message };
  const parsedEntries = z.array(entryRowSchema).min(1, "Add at least one car first.").max(64).safeParse(entries);
  if (!parsedEntries.success) return { ok: false, message: parsedEntries.error.issues[0].message };

  let replaced = false;
  const file = presetsFile(instance.id);
  await withInstanceLock(`presets:${instance.id}`, async () => {
    const presets = await loadPresets(file);
    replaced = presets.some((p) => p.name.toLowerCase() === parsedName.data.toLowerCase());
    await savePresets(file, [
      ...presets.filter((p) => p.name.toLowerCase() !== parsedName.data.toLowerCase()),
      { name: parsedName.data, entries: parsedEntries.data, savedBy: user.name, savedAt: new Date().toISOString() },
    ]);
  });
  await logActivity({ instanceId: instance.id, user: user.name, message: `${replaced ? "updated" : "saved"} grid preset “${parsedName.data}”` });
  revalidatePath(`/servers/${instance.id}`);
  return { ok: true, message: `Preset “${parsedName.data}” ${replaced ? "updated" : "saved"}.` };
}

export async function deleteEntryPreset(instanceId: string, name: string): Promise<PresetResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return { ok: false, message: "Unknown server." };

  const file = presetsFile(instance.id);
  await withInstanceLock(`presets:${instance.id}`, async () => {
    await savePresets(file, (await loadPresets(file)).filter((p) => p.name !== name));
  });
  await logActivity({ instanceId: instance.id, user: user.name, message: `deleted grid preset “${name}”` });
  revalidatePath(`/servers/${instance.id}`);
  return { ok: true, message: `Preset “${name}” deleted.` };
}
