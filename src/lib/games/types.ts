import type { GameId, Instance } from "@/lib/config";

// Every game the portal supports plugs in through one adapter. The dashboard, start/stop/restart,
// logs and the activity log are shared; each adapter only knows its own game's files.
//
// Adding a game (Valheim, Minecraft…):
//   1. add its id to `gameIds` in src/lib/config.ts
//   2. create src/lib/games/<game>/adapter.ts implementing GameAdapter
//   3. register it in src/lib/games/index.ts
//   4. add its settings panel to src/app/servers/[id]/page.tsx

export type Player = { name: string; car?: string };

export type LiveInfo = {
  /** null when the game server isn't answering (stopped, still loading, or no query port). */
  players: Player[] | null;
  maxPlayers: number | null;
};

export type SummaryItem = { label: string; value: string };

export interface GameAdapter {
  id: GameId;
  label: string;
  /** Short facts for the dashboard card, e.g. Track: Nordschleife. */
  summary(instance: Instance): Promise<SummaryItem[]>;
  /** Who's online right now, asked from the running game server. */
  liveInfo(instance: Instance): Promise<LiveInfo>;
  /** What players type/click to join, e.g. "play.example.com:9600". */
  joinInfo(instance: Instance, publicHost: string): Promise<{ address: string; link?: string } | null>;
}
