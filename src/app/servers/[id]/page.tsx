import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/activity-list";
import { AssettoSettingsForm } from "@/components/assetto-settings-form";
import { LivePanel } from "@/components/live-panel";
import { recentActivity } from "@/lib/activity";
import { getInstance, type Instance } from "@/lib/config";
import { getContent } from "@/lib/games/assetto-corsa/catalog";
import { loadPresets, presetsFile } from "@/lib/games/assetto-corsa/entry-presets";
import { readServerCfg } from "@/lib/games/assetto-corsa/server-config";
import { loadRememberedSessions, sessionMemoryFile } from "@/lib/games/assetto-corsa/session-memory";
import { initialLive } from "@/lib/live";
import { requireUser } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/servers/[id]">): Promise<Metadata> {
  return { title: getInstance((await params).id)?.name ?? "Not found" };
}

export default async function ServerPage({ params }: PageProps<"/servers/[id]">) {
  await requireUser();
  const instance = getInstance((await params).id);
  if (!instance) notFound();
  const [live, activity] = await Promise.all([initialLive(instance), recentActivity(instance.id)]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-accent">← All servers</Link>
        <h1 className="mt-1 font-display text-2xl font-bold">{instance.name}</h1>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <LivePanel instanceId={instance.id} initial={live} showLogs />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-lg font-bold">Settings</h2>
          {instance.game === "assetto-corsa" && (
            <Link href={`/servers/${instance.id}/content`} className="ml-auto text-sm text-accent hover:underline">
              New mod not in the list? Add cars & tracks →
            </Link>
          )}
        </div>
        <SettingsPanel instance={instance} />
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold">Recent changes</h2>
        <ActivityList entries={activity} />
      </section>
    </div>
  );
}

/** Each game has its own settings form. */
async function SettingsPanel({ instance }: { instance: Instance }) {
  switch (instance.game) {
    case "assetto-corsa": {
      const remembered = await loadRememberedSessions(sessionMemoryFile(instance.id));
      const [content, cfg, presets] = await Promise.all([getContent(instance), readServerCfg(instance.dir, remembered), loadPresets(presetsFile(instance.id))]);
      if (!cfg) {
        return <p className="text-danger">No <code>cfg/server_cfg.ini</code> in <code>{instance.dir}</code>. Copy your server config there first.</p>;
      }
      return (
        <AssettoSettingsForm
          instanceId={instance.id}
          current={cfg.settings}
          cars={content.cars.map(({ id, name, brand, skins }) => ({ id, name, brand, skins }))}
          tracks={content.tracks}
          presets={presets}
        />
      );
    }
  }
}
