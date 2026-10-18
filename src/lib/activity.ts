import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/config";

// "Who changed what": one JSON object per line in data/activity.jsonl.

export type ActivityEntry = { at: string; instanceId: string; user: string; message: string };

const file = () => path.join(dataDir(), "activity.jsonl");

export async function logActivity(entry: Omit<ActivityEntry, "at">) {
  await mkdir(dataDir(), { recursive: true });
  await appendFile(file(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export async function recentActivity(instanceId?: string, limit = 15): Promise<ActivityEntry[]> {
  let text: string;
  try {
    text = await readFile(file(), "utf8");
  } catch {
    return [];
  }
  const entries: ActivityEntry[] = [];
  for (const line of text.trimEnd().split("\n").reverse()) {
    try {
      const e = JSON.parse(line) as ActivityEntry;
      if (!instanceId || e.instanceId === instanceId) entries.push(e);
    } catch {
      // skip a damaged line
    }
    if (entries.length >= limit) break;
  }
  return entries;
}
