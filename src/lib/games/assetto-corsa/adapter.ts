import type { GameAdapter, LiveInfo, Player } from "@/lib/games/types";
import { getContent } from "./catalog";
import { carsOf, totalSlots } from "./entries";
import { readServerCfg, startTimeOf } from "./server-config";

export const assettoCorsa: GameAdapter = {
  id: "assetto-corsa",
  label: "Assetto Corsa",

  async summary(instance) {
    const cfg = await readServerCfg(instance.dir);
    if (!cfg) return [{ label: "Config", value: "cfg/server_cfg.ini not found" }];
    const { tracks, cars } = await getContent(instance);
    const track = tracks.find((t) => t.id === cfg.settings.track);
    const layout = track?.layouts.find((l) => l.id === cfg.settings.layout);
    const { settings } = cfg;
    const carNames = carsOf(settings.entries).map((id) => cars.find((c) => c.id === id)?.name ?? id);
    return [
      { label: "Track", value: layout && track && track.layouts.length > 1 ? `${track.name} · ${layout.name}` : (track?.name ?? settings.track) },
      { label: "Cars", value: carNames.length > 3 ? `${carNames.slice(0, 3).join(", ")} +${carNames.length - 3} more` : carNames.join(", ") },
      {
        label: "Session",
        value: [
          `${totalSlots(settings.entries)} slots`,
          settings.raceLaps !== null ? `${settings.raceLaps} laps` : null,
          `starts ${startTimeOf(settings.sunAngle)}`,
          `damage ${settings.damage}%`,
          `tyre wear ${settings.tyreWear}%`,
        ].filter(Boolean).join(" · "),
      },
    ];
  },

  async liveInfo(instance) {
    const cfg = await readServerCfg(instance.dir);
    if (!cfg?.ports.http) return { players: null, maxPlayers: null };
    return queryServer(cfg.ports.http);
  },

  async joinInfo(instance, publicHost) {
    const cfg = await readServerCfg(instance.dir);
    if (!cfg?.ports.tcp || !publicHost) return null;
    const link = cfg.ports.http
      ? `https://acstuff.club/s/q:race/online/join?ip=${encodeURIComponent(publicHost)}&httpPort=${cfg.ports.http}`
      : undefined;
    return { address: `${publicHost}:${cfg.ports.http ?? cfg.ports.tcp}`, link };
  },
};

/** AssettoServer's lobby API on the HTTP port: /api/details lists every slot and who's in it. */
async function queryServer(httpPort: number): Promise<LiveInfo> {
  try {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/details`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!res.ok) return { players: null, maxPlayers: null };
    return parseDetails(await res.json());
  } catch {
    return { players: null, maxPlayers: null };
  }
}

/** Field names differ in case between server versions, so look them up case-insensitively. */
export function parseDetails(json: unknown): LiveInfo {
  const field = (obj: unknown, name: string): unknown => {
    if (!obj || typeof obj !== "object") return undefined;
    const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? (obj as Record<string, unknown>)[key] : undefined;
  };
  const slots = field(field(json, "players"), "cars");
  const players: Player[] = Array.isArray(slots)
    ? slots
        .filter((s) => field(s, "isConnected") === true)
        .map((s) => ({ name: String(field(s, "driverName") ?? "Driver"), car: String(field(s, "model") ?? "") || undefined }))
    : [];
  const max = field(json, "maxClients");
  return { players, maxPlayers: typeof max === "number" ? max : null };
}
