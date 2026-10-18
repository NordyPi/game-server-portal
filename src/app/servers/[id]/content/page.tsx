import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddCarForm, AddTrackForm, RemoveEntryButton } from "@/components/catalog-forms";
import { getInstance } from "@/lib/config";
import { getContent } from "@/lib/games/assetto-corsa/catalog";
import type { Source } from "@/lib/games/assetto-corsa/content";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Cars & tracks" };

export default async function ContentPage({ params }: PageProps<"/servers/[id]/content">) {
  await requireUser();
  const instance = getInstance((await params).id);
  if (instance?.game !== "assetto-corsa") notFound();
  const { cars, tracks } = await getContent(instance);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/servers/${instance.id}`} className="text-sm text-muted hover:text-accent">← {instance.name}</Link>
        <h1 className="mt-1 font-display text-2xl font-bold">Cars & tracks</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          These are the choices in the settings lists. When you all install a new mod, add it here with its <strong>folder name</strong>.
          The server only needs that name. Everyone joining needs the mod installed on their own PC. To find the folder name,
          open the mod&apos;s folder in <code className="font-mono">assettocorsa\content\cars</code> or{" "}
          <code className="font-mono">\tracks</code> (Content Manager&apos;s <em>Folder</em> button takes you there).
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-lg font-bold">Add a car</h2>
        <AddCarForm instanceId={instance.id} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-lg font-bold">Add a track</h2>
        <AddTrackForm instanceId={instance.id} />
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold">Tracks ({tracks.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {tracks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t.name}</div>
                <div className="font-mono text-xs text-muted">{t.id}</div>
                {(t.layouts.length > 1 || t.layouts[0]?.id) && (
                  <ul className="mt-1 text-sm text-muted">
                    {t.layouts.map((l) => (
                      <li key={l.id}>
                        {l.name} · <span className="font-mono text-xs">{l.id || "(default)"}</span>
                        {l.pitboxes ? ` · ${l.pitboxes} pits` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {t.layouts.length === 1 && !t.layouts[0].id && t.layouts[0].pitboxes && (
                  <div className="text-sm text-muted">{t.layouts[0].pitboxes} pits</div>
                )}
              </div>
              <Badges source={t} />
              {t.manual && <RemoveEntryButton instanceId={instance.id} kind="track" id={t.id} label={t.name} />}
            </li>
          ))}
          {tracks.length === 0 && <li className="px-4 py-3 text-sm text-muted">No tracks yet. Add one above.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold">Cars ({cars.length})</h2>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {cars.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name}</div>
                <div className="font-mono text-xs text-muted">{c.id}</div>
                <div className="mt-0.5 text-sm text-muted">
                  {c.skins.length ? `Skins: ${c.skins.join(", ")}` : "No skins listed (default skin)"}
                </div>
              </div>
              <Badges source={c} />
              {c.manual && <RemoveEntryButton instanceId={instance.id} kind="car" id={c.id} label={c.name} />}
            </li>
          ))}
          {cars.length === 0 && <li className="px-4 py-3 text-sm text-muted">No cars yet. Add one above.</li>}
        </ul>
      </section>
    </div>
  );
}

function Badges({ source }: { source: Source }) {
  return (
    <span className="flex gap-1.5 text-xs">
      {source.onServer && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted" title="Files found in the server's content folder">
          on server
        </span>
      )}
      {source.manual && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-accent" title="Added on this page">
          added by hand
        </span>
      )}
    </span>
  );
}
