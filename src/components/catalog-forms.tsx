"use client";

import { useRef, useState, useTransition } from "react";
import { addCatalogCar, addCatalogTrack, removeCatalogEntry, type CatalogResult } from "@/app/catalog-actions";

function useCatalogForm(submit: (form: FormData) => Promise<CatalogResult>, onSuccess?: () => void) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [pending, startTransition] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await submit(data);
      setResult(r);
      if (r.ok) {
        formRef.current?.reset();
        onSuccess?.();
      }
    });
  };
  return { formRef, onSubmit, pending, result, errors: result?.errors ?? {} };
}

export function AddCarForm({ instanceId }: { instanceId: string }) {
  const skins = useRows();
  const { formRef, onSubmit, pending, result, errors } = useCatalogForm((f) => addCatalogCar(instanceId, f), skins.clear);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Folder name" error={errors.id} hint="Exactly as in content\cars, e.g. ks_mazda_miata">
          <input className="field font-mono" name="id" required maxLength={100} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Display name" error={errors.name} hint="Optional, e.g. Mazda MX-5 NA">
          <input className="field" name="name" maxLength={100} autoComplete="off" />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-semibold">Skins</div>
        {skins.rows.length === 0 ? (
          <p className="text-sm text-muted">
            Optional. Add the skin folder names (from <code className="font-mono">content\cars\&lt;car&gt;\skins</code>) to pick a skin per car
            in the settings. Without any, players get the car&apos;s default skin.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {skins.rows.map((key) => (
              <div key={key} className="flex gap-2">
                <input className="field font-mono" name="skin" placeholder="skin folder name" required maxLength={100} autoComplete="off" spellCheck={false} />
                <button type="button" className="btn" onClick={() => skins.remove(key)} title="Remove skin">✕</button>
              </div>
            ))}
          </div>
        )}
        {errors.skins && <p className="mt-1 text-sm text-danger">{errors.skins}</p>}
        <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={skins.add}>
          + Add a skin
        </button>
      </div>

      <Submit pending={pending} label="Add car" result={result} />
    </form>
  );
}

/** A growable list of input rows; each row only needs a stable key. */
function useRows() {
  const [rows, setRows] = useState<number[]>([]);
  const next = useRef(0);
  return {
    rows,
    add: () => setRows((r) => [...r, next.current++]),
    remove: (key: number) => setRows((r) => r.filter((k) => k !== key)),
    clear: () => setRows([]),
  };
}

export function AddTrackForm({ instanceId }: { instanceId: string }) {
  const layouts = useRows();
  const { formRef, onSubmit, pending, result, errors } = useCatalogForm((f) => addCatalogTrack(instanceId, f), layouts.clear);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Folder name" error={errors.id} hint="Exactly as in content\tracks, e.g. ks_nordschleife">
          <input className="field font-mono" name="id" required maxLength={100} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Display name" error={errors.name} hint="Optional, e.g. Nordschleife">
          <input className="field" name="name" maxLength={100} autoComplete="off" />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-semibold">Layouts</div>
        {layouts.rows.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Field label="" error={errors.pitboxes} hint="Pit boxes (optional): the most players the track can hold">
              <input className="field" name="pitboxes" type="number" min={1} max={128} placeholder="Pit boxes" />
            </Field>
            <p className="text-sm text-muted sm:pt-2">
              Most tracks have just one layout, so you can leave this. If the track folder has a sub-folder per layout
              (like <code className="font-mono">ks_nordschleife\endurance</code>), add one row for each.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="hidden gap-2 text-xs text-muted sm:grid sm:grid-cols-[1fr_1fr_7rem_2rem]">
              <span>Layout folder</span>
              <span>Display name (optional)</span>
              <span>Pit boxes</span>
            </div>
            {layouts.rows.map((key) => (
              <div key={key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_7rem_2rem]">
                <input className="field font-mono" name="layoutId" placeholder="layout folder" required maxLength={100} autoComplete="off" spellCheck={false} />
                <button type="button" className="btn sm:order-last" onClick={() => layouts.remove(key)} title="Remove layout">
                  ✕
                </button>
                <input className="field" name="layoutName" placeholder="Display name" maxLength={100} autoComplete="off" />
                <input className="field" name="layoutPitboxes" type="number" min={1} max={128} placeholder="Pits" />
              </div>
            ))}
            {(errors.layouts || errors.pitboxes) && <p className="text-sm text-danger">{errors.layouts ?? errors.pitboxes}</p>}
          </div>
        )}
        <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={layouts.add}>
          + Add a layout
        </button>
      </div>

      <Submit pending={pending} label="Add track" result={result} />
    </form>
  );
}

export function RemoveEntryButton({ instanceId, kind, id, label }: { instanceId: string; kind: "car" | "track"; id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger px-2 py-1 text-xs"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${label} from the list?`)) return;
        startTransition(async () => {
          await removeCatalogEntry(instanceId, kind, id);
        });
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-semibold">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-sm text-danger">{error}</span> : hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Submit({ pending, label, result }: { pending: boolean; label: string; result: CatalogResult | null }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {result && !pending && <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
    </div>
  );
}
