import "server-only";
import type { Instance } from "@/lib/config";
import { getAdapter } from "@/lib/games";
import type { LiveResponse } from "@/lib/live-types";
import { getServiceStatus } from "@/lib/service";

/** First paint of a LivePanel; it keeps itself up to date from /api/servers/[id]/live afterwards. */
export async function initialLive(instance: Instance): Promise<LiveResponse> {
  const service = await getServiceStatus(instance.unit);
  const live = service.state === "running" ? await getAdapter(instance.game).liveInfo(instance) : { players: null, maxPlayers: null };
  return { service, live };
}
