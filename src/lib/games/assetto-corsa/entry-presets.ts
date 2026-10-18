import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataDir } from "@/lib/config";
import { CONTENT_ID } from "./content";

// Saved grids ("Drift night: 6× AE86 panda, 4× S15") that can be loaded into the settings form
// with one click. Stored per server in data/entry-presets-<instance id>.json.

const folder = z.string().regex(CONTENT_ID);
export const entryRowSchema = z.object({
  car: folder,
  skin: z.union([z.literal(""), folder]),
  count: z.number().int().min(1).max(128),
});
export const presetNameSchema = z
  .string()
  .trim()
  .min(1, "Give the preset a name.")
  .max(60, "Keep the name under 60 characters.")
  .regex(/^[^\r\n]*$/, "One line only.");

const presetSchema = z.object({
  name: presetNameSchema,
  entries: z.array(entryRowSchema).min(1).max(64),
  savedBy: z.string(),
  savedAt: z.string(),
});
const fileSchema = z.object({ presets: z.array(presetSchema).default([]) });

export type EntryPreset = z.infer<typeof presetSchema>;

export function presetsFile(instanceId: string) {
  return path.join(dataDir(), `entry-presets-${instanceId}.json`);
}

export async function loadPresets(file: string): Promise<EntryPreset[]> {
  try {
    return fileSchema.parse(JSON.parse(await readFile(file, "utf8"))).presets;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`${file} is damaged: ${err instanceof Error ? err.message : err}`);
  }
}

export async function savePresets(file: string, presets: EntryPreset[]) {
  await mkdir(path.dirname(file), { recursive: true });
  const sorted = [...presets].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify({ presets: sorted }, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}
