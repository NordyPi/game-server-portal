"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { controlServer } from "@/app/actions";
import type { LiveResponse } from "@/lib/live-types";
import type { ServiceAction, ServiceState } from "@/lib/service";

const POLL_MS = 5000;

const stateStyle: Record<ServiceState, { label: string; dot: string }> = {
  running: { label: "Running", dot: "bg-ok" },
  starting: { label: "Starting…", dot: "bg-warn animate-pulse" },
  stopping: { label: "Stopping…", dot: "bg-warn animate-pulse" },
  stopped: { label: "Stopped", dot: "bg-muted" },
  failed: { label: "Crashed", dot: "bg-danger" },
  unknown: { label: "Unknown", dot: "bg-muted" },
};

/** Live status, player list, start/stop/restart and (optionally) the server log, refreshed every few seconds. */
export function LivePanel({ instanceId, initial, showLogs = false }: { instanceId: string; initial: LiveResponse; showLogs?: boolean }) {
  const [data, setData] = useState(initial);
  const [logsOpen, setLogsOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${instanceId}/live${logsOpen ? "?logs" : ""}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // offline for a moment; try again next tick
    }
  }, [instanceId, logsOpen]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data.logs]);

  function act(action: ServiceAction) {
    if (action !== "start" && (data.live.players?.length ?? 0) > 0 && !confirm(`${data.live.players!.length} people are on the server. ${action === "stop" ? "Stop" : "Restart"} anyway?`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await controlServer(instanceId, action);
      setMessage({ ok: result.ok, text: result.message });
      await refresh();
    });
  }

  const { service, live } = data;
  const style = stateStyle[service.state];
  const running = service.state === "running";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className={`size-2.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
        {running && service.since && <Uptime since={service.since} />}
        {/* players is null while the game server is still loading or doesn't answer queries */}
        {running && live.players && (
          <span className="text-sm text-muted">
            {live.players.length}
            {live.maxPlayers ? ` / ${live.maxPlayers}` : ""} online
          </span>
        )}
        {service.state === "unknown" && service.detail && <span className="text-sm text-danger">{service.detail}</span>}

        <div className="ml-auto flex gap-2">
          <button className="btn" disabled={pending || running} onClick={() => act("start")}>Start</button>
          <button className="btn" disabled={pending || !running} onClick={() => act("restart")}>Restart</button>
          <button className="btn btn-danger" disabled={pending || service.state === "stopped"} onClick={() => act("stop")}>Stop</button>
        </div>
      </div>

      {message && <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}

      {running && live.players && live.players.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {live.players.map((p, i) => (
            <li key={i} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
              {p.name}
              {p.car && <span className="text-muted"> · {p.car}</span>}
            </li>
          ))}
        </ul>
      )}

      {showLogs && (
        <div>
          <button className="text-sm text-muted hover:text-accent" onClick={() => { setLogsOpen((o) => !o); }}>
            {logsOpen ? "▾ Hide server log" : "▸ Show server log"}
          </button>
          {logsOpen && (
            <pre ref={logRef} className="mt-2 max-h-96 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed">
              {data.logs ? data.logs.join("\n") || "(empty)" : "Loading…"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Uptime({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  if (now === null) return null;
  const mins = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const text = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return <span className="text-sm text-muted">up {text}</span>;
}
