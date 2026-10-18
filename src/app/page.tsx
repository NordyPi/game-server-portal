import Link from "next/link";
import { ActivityList } from "@/components/activity-list";
import { LivePanel } from "@/components/live-panel";
import { recentActivity } from "@/lib/activity";
import { getConfig, type Instance } from "@/lib/config";
import { getAdapter } from "@/lib/games";
import { initialLive } from "@/lib/live";
import { requireUser } from "@/lib/session";

export default async function Dashboard() {
  await requireUser();
  const { instances } = getConfig();
  const activity = await recentActivity(undefined, 10);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        {instances.map((instance) => (
          <ServerCard key={instance.id} instance={instance} />
        ))}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold">Recent changes</h2>
        <ActivityList entries={activity} serverNames={Object.fromEntries(instances.map((i) => [i.id, i.name]))} />
      </section>
    </div>
  );
}

async function ServerCard({ instance }: { instance: Instance }) {
  const adapter = getAdapter(instance.game);
  const [summary, join, live] = await Promise.all([
    adapter.summary(instance),
    adapter.joinInfo(instance, getConfig().publicHost),
    initialLive(instance),
  ]);

  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl font-bold">{instance.name}</h2>
        {adapter.label !== instance.name && <span className="text-sm text-muted">{adapter.label}</span>}
        <Link href={`/servers/${instance.id}`} className="btn btn-primary ml-auto">
          Change settings
        </Link>
      </div>

      <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {summary.map((s) => (
          <div key={s.label} className="contents">
            <dt className="text-muted">{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
        {join && (
          <div className="contents">
            <dt className="text-muted">Join</dt>
            <dd>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{join.address}</code>
              {join.link && (
                <a href={join.link} target="_blank" rel="noreferrer" className="ml-3 text-accent hover:underline">
                  Open in Content Manager ↗
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>

      <LivePanel instanceId={instance.id} initial={live} />
    </article>
  );
}
