import "server-only";
import type { GameId } from "@/lib/config";
import { assettoCorsa } from "./assetto-corsa/adapter";
import type { GameAdapter } from "./types";

const adapters: Record<GameId, GameAdapter> = {
  "assetto-corsa": assettoCorsa,
};

export function getAdapter(game: GameId): GameAdapter {
  return adapters[game];
}
