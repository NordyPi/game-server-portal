import type { LiveInfo } from "@/lib/games/types";
import type { ServiceStatus } from "@/lib/service";

/** Response of GET /api/servers/[id]/live */
export type LiveResponse = { service: ServiceStatus; live: LiveInfo; logs?: string[] };
