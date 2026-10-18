import type { ActivityEntry } from "@/lib/activity";

export function ActivityList({ entries, serverNames }: { entries: ActivityEntry[]; serverNames?: Record<string, string> }) {
  if (entries.length === 0) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {entries.map((e, i) => (
        <li key={i} className="flex gap-3 py-2 text-sm">
          <time dateTime={e.at} className="w-28 shrink-0 text-muted tabular-nums">
            {new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </time>
          <span>
            <strong className="font-semibold">{e.user}</strong> {e.message}
            {serverNames && <span className="text-muted"> · {serverNames[e.instanceId] ?? e.instanceId}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
