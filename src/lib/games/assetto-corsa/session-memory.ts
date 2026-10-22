import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/config";
import { DEFAULT_SESSIONS, sessionsSchema, validateSessions, type Sessions } from "./sessions";

// Switching an event off removes its section from server_cfg.ini, and with it its duration/laps.
// So the portal remembers the last values of every event in data/sessions-<instance id>.json,
// and an event switched back on starts from them.

export function sessionMemoryFile(instanceId: string) {
  return path.join(dataDir(), `sessions-${instanceId}.json`);
}

export async function loadRememberedSessions(file: string): Promise<Sessions | undefined> {
  try {
    return sessionsSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return undefined; // nothing saved yet (or unreadable): defaults are fine
  }
}

/** Saves every event's values, on or off. Values that don't pass the checks fall back to the defaults. */
export async function rememberSessions(file: string, sessions: Sessions) {
  const valid = (key: keyof Sessions) =>
    validateSessions({ ...DEFAULT_SESSIONS, [key]: { ...sessions[key], enabled: true } }) === undefined ? sessions[key] : DEFAULT_SESSIONS[key];
  const safe = { practice: valid("practice"), qualify: valid("qualify"), race: valid("race") } as Sessions;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(safe, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}
