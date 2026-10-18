import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// The portal's own settings live in a JSON file on the server (portal.config.json), not in a
// database: which game servers exist, where they are installed, and which systemd unit runs each.

export const isProduction = process.env.NODE_ENV === "production";

const gameIds = ["assetto-corsa"] as const;
export type GameId = (typeof gameIds)[number];

const instanceSchema = z.object({
  /** Used in URLs: /servers/<id> */
  id: z.string().regex(/^[a-z0-9-]{1,32}$/, "lowercase letters, digits and dashes only"),
  game: z.enum(gameIds),
  name: z.string().min(1).max(60),
  /** Folder the game server runs from (its working directory). */
  dir: z.string().min(1),
  /** systemd user unit, e.g. assetto-corsa@main.service */
  unit: z.string().regex(/^[A-Za-z0-9@._-]+\.service$/, "must be a .service unit name"),
});

const configSchema = z.object({
  /** Hostname (or IP) friends connect their game to, e.g. play.yourdomain.com. Shown on the dashboard. */
  publicHost: z.string().default(""),
  /** Optional display names for the activity log, keyed by Cloudflare Access email. */
  users: z.record(z.string(), z.string()).default({}),
  instances: z.array(instanceSchema).min(1),
});

export type Instance = z.infer<typeof instanceSchema>;
export type PortalConfig = z.infer<typeof configSchema>;

function configPath() {
  if (process.env.PORTAL_CONFIG) return path.resolve(process.env.PORTAL_CONFIG);
  if (!isProduction) return path.resolve("portal.config.dev.json");
  throw new Error("PORTAL_CONFIG is not set (see .env.example)");
}

let cached: { config: PortalConfig } | null = null;

/** Read once per process; restart the portal after editing portal.config.json. */
export function getConfig(): PortalConfig {
  if (cached && isProduction) return cached.config;
  const file = configPath();
  const parsed = configSchema.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
  const ids = new Set<string>();
  for (const inst of parsed.instances) {
    if (ids.has(inst.id)) throw new Error(`${file}: duplicate instance id "${inst.id}"`);
    ids.add(inst.id);
    inst.dir = path.resolve(path.dirname(file), inst.dir);
  }
  cached = { config: parsed };
  return parsed;
}

export function getInstance(id: string): Instance | null {
  return getConfig().instances.find((i) => i.id === id) ?? null;
}

export function dataDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "data");
}
