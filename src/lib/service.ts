import "server-only";
import { execFile } from "node:child_process";
import { uptime } from "node:os";
import { promisify } from "node:util";
import { isProduction } from "@/lib/config";

// Game servers run as systemd *user* services (see deploy/systemd/), so the portal controls them
// with `systemctl --user` as the same Linux user: no sudo, no root. Servers keep running when the
// portal restarts, come back after a crash, and start on boot.
//
// Commands go through execFile (never a shell) and unit names come from portal.config.json,
// validated by its schema. On Windows during development a fake in-memory service is used instead.

const run = promisify(execFile);

export type ServiceState = "running" | "starting" | "stopping" | "stopped" | "failed" | "unknown";
export type ServiceStatus = { state: ServiceState; since: string | null; detail: string };
export type ServiceAction = "start" | "stop" | "restart";

const mode = process.env.SERVICE_MODE ?? (isProduction ? "systemd" : "mock");

export async function getServiceStatus(unit: string): Promise<ServiceStatus> {
  if (mode === "mock") return mock.status(unit);
  try {
    const { stdout } = await run("systemctl", [
      "--user", "show", unit, "--property=ActiveState,SubState,ActiveEnterTimestampMonotonic,LoadState",
    ]);
    return parseSystemctlShow(stdout);
  } catch (err) {
    return { state: "unknown", since: null, detail: errorText(err) };
  }
}

export async function controlService(unit: string, action: ServiceAction): Promise<void> {
  if (mode === "mock") return mock.control(unit, action);
  await run("systemctl", ["--user", action, unit], { timeout: 60_000 });
}

export async function getServiceLogs(unit: string, lines = 200): Promise<string[]> {
  if (mode === "mock") return mock.logs(unit);
  try {
    const { stdout } = await run(
      "journalctl",
      ["--user", "-u", unit, "-n", String(lines), "--no-pager", "-o", "short-iso"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.split("\n").filter(Boolean);
  } catch (err) {
    return [`(could not read logs: ${errorText(err)})`];
  }
}

export function parseSystemctlShow(stdout: string): ServiceStatus {
  const props = Object.fromEntries(
    stdout.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (props.LoadState === "not-found") return { state: "unknown", since: null, detail: "systemd unit not installed" };
  const active = props.ActiveState ?? "";
  const state: ServiceState =
    active === "active" ? "running"
    : active === "activating" || active === "reloading" ? "starting"
    : active === "deactivating" ? "stopping"
    : active === "failed" ? "failed"
    : active === "inactive" ? "stopped"
    : "unknown";
  // The monotonic timestamp (µs since boot) avoids parsing systemd's locale/timezone-dependent dates.
  const mono = Number(props.ActiveEnterTimestampMonotonic);
  const since = state === "running" && mono > 0 ? new Date(Date.now() - (uptimeSeconds() * 1e6 - mono) / 1e3).toISOString() : null;
  return { state, since, detail: props.SubState ?? "" };
}

let uptimeSeconds = uptime;
/** Tests replace the clock source. */
export function setUptimeSourceForTests(fn: () => number) {
  uptimeSeconds = fn;
}

function errorText(err: unknown) {
  if (err && typeof err === "object" && "stderr" in err && typeof err.stderr === "string" && err.stderr.trim()) {
    return err.stderr.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

// ---- development stand-in --------------------------------------------------------------------

type MockEntry = { running: boolean; since: string | null; log: string[] };
const g = globalThis as unknown as { __mockServices?: Map<string, MockEntry> };
const services = (g.__mockServices ??= new Map());

const mock = {
  entry(unit: string): MockEntry {
    let e = services.get(unit);
    if (!e) {
      e = { running: true, since: new Date().toISOString(), log: [`${stamp()} [mock] ${unit} started`] };
      services.set(unit, e);
    }
    return e;
  },
  status(unit: string): ServiceStatus {
    const e = mock.entry(unit);
    return { state: e.running ? "running" : "stopped", since: e.since, detail: "mock" };
  },
  async control(unit: string, action: ServiceAction) {
    const e = mock.entry(unit);
    await new Promise((r) => setTimeout(r, 600));
    e.running = action !== "stop";
    e.since = e.running ? new Date().toISOString() : null;
    e.log.push(`${stamp()} [mock] systemctl --user ${action} ${unit}`);
  },
  logs(unit: string) {
    return mock.entry(unit).log.slice(-200);
  },
};

function stamp() {
  return new Date().toISOString().slice(0, 19);
}
