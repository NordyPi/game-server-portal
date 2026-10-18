import { NextResponse } from "next/server";
import { getInstance } from "@/lib/config";
import { getAdapter } from "@/lib/games";
import { getServiceLogs, getServiceStatus } from "@/lib/service";
import { requireUser } from "@/lib/session";

/** Polled by the dashboard every few seconds: service state, who's online, and (optionally) recent log lines. */
export async function GET(request: Request, { params }: RouteContext<"/api/servers/[id]/live">) {
  await requireUser();
  const instance = getInstance((await params).id);
  if (!instance) return NextResponse.json({ error: "not found" }, { status: 404 });

  const wantLogs = new URL(request.url).searchParams.has("logs");
  const service = await getServiceStatus(instance.unit);
  const [live, logs] = await Promise.all([
    service.state === "running" ? getAdapter(instance.game).liveInfo(instance) : { players: null, maxPlayers: null },
    wantLogs ? getServiceLogs(instance.unit) : undefined,
  ]);
  return NextResponse.json({ service, live, logs }, { headers: { "Cache-Control": "no-store" } });
}
