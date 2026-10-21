"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addInUseToCatalog, removeCatalogEntry, saveCatalogCar, saveCatalogTrack, type CatalogResult } from "@/app/catalog-actions";
import type { ManualCar, ManualLayout, ManualTrack } from "@/lib/games/assetto-corsa/catalog";

// The forms on the "Cars & tracks" page. CarForm and TrackForm do both jobs:
//   - add:  no `initial`, fields start empty, the form clears itself after saving
//   - edit: `initial` is the saved entry, fields start filled in, `onDone` closes the editor
// Both send the same fields to the same server action; editing also sends "originalId".

type FormProps<T> = {
  instanceId: string;
  /** The saved entry being edited (from data/catalog-*.json, not the merged lists). */
  initial?: T;
  /** The folder exists on the server, so its name can't be changed. */
  lockId?: boolean;
  /** Edit mode: called after a successful save (with its result) or on Cancel (without). */
  onDone?: (result?: CatalogResult) => void;
};

function useCatalogForm(submit: (form: FormData) => Promise<CatalogResult>, onSuccess?: (result: CatalogResult) => void) {
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
        onSuccess?.(r);
      }
    });
  };
  return { formRef, onSubmit, pending, result, errors: result?.errors ?? {} };
}

/**
 * A growable list of input rows. Each row has a stable key plus the value it starts with
 * (filled in when editing, empty for rows added with the + button).
 */
function useRows<T>(initial: T[], empty: T) {
  const next = useRef(initial.length);
  const [rows, setRows] = useState(() => initial.map((value, key) => ({ key, value })));
  return {
    rows,
    add: () => setRows((r) => [...r, { key: next.current++, value: empty }]),
    remove: (key: number) => setRows((r) => r.filter((row) => row.key !== key)),
    reset: () => setRows(initial.map((value, key) => ({ key, value }))),
  };
}

type SkinRow = { name: string; fromServer: boolean };

export function CarForm({ instanceId, initial, lockId, onDone, serverSkins = [] }: FormProps<ManualCar> & { serverSkins?: string[] }) {
  const editing = Boolean(initial);
  // Typed skins can be edited and removed; the server's own skins (its skins/ folder or the current
  // entry list) can only be removed, which hides them from the lists.
  const skins = useRows<SkinRow>(
    [...(initial?.skins ?? []).map((name) => ({ name, fromServer: false })), ...serverSkins.map((name) => ({ name, fromServer: true }))],
    { name: "", fromServer: false },
  );
  const { formRef, onSubmit, pending, result, errors } = useCatalogForm(
    (f) => saveCatalogCar(instanceId, f),
    editing ? onDone : skins.reset,
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      {editing && <input type="hidden" name="originalId" value={initial!.id} />}
      {/* Which server skins were on screen, so the save knows which ones were removed. */}
      {serverSkins.map((name) => (
        <input key={name} type="hidden" name="serverSkin" value={name} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Folder name" error={errors.id} hint={lockId ? "This folder is on the server, so its name stays." : "Exactly as in content\\cars, e.g. ks_mazda_miata"}>
          <IdInput defaultValue={initial?.id} locked={lockId} />
        </Field>
        <Field label="Display name" error={errors.name} hint="Optional, e.g. Mazda MX-5 NA">
          <input className="field" name="name" defaultValue={initial?.name} maxLength={100} autoComplete="off" />
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
            {skins.rows.map(({ key, value }) => (
              <div key={key} className="flex gap-2">
                {value.fromServer ? (
                  <>
                    <input type="hidden" name="skin" value={value.name} />
                    <span className="field flex items-center gap-2 truncate font-mono" title="Found on the server. ✕ hides it from the skin lists; the server's files stay.">
                      <span className="truncate">{value.name}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-surface px-2 py-0.5 font-sans text-xs text-muted">on server</span>
                    </span>
                  </>
                ) : (
                  <input className="field font-mono" name="skin" defaultValue={value.name} placeholder="skin folder name" required maxLength={100} autoComplete="off" spellCheck={false} />
                )}
                <button type="button" className="btn" onClick={() => skins.remove(key)} title={value.fromServer ? "Hide this skin" : "Remove skin"}>✕</button>
              </div>
            ))}
          </div>
        )}
        {errors.skins && <p className="mt-1 text-sm text-danger">{errors.skins}</p>}
        {initial?.hiddenSkins?.length ? (
          <p className="mt-1 text-xs text-muted">
            Hidden: {initial.hiddenSkins.join(", ")}. Add one again with + to bring it back.
          </p>
        ) : null}
        <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={skins.add}>
          + Add a skin
        </button>
      </div>

      <Submit pending={pending} label={editing ? "Save changes" : "Add car"} result={result} onCancel={editing ? () => onDone?.() : undefined} />
    </form>
  );
}

export function TrackForm({ instanceId, initial, lockId, onDone }: FormProps<ManualTrack>) {
  const editing = Boolean(initial);
  // Editing shows every saved layout as a row, including the main one without a sub-folder, so adding
  // a second layout can't silently drop the first. New tracks start with just the "Pit boxes" field.
  const savedLayouts = initial?.layouts ?? [];
  const layouts = useRows<ManualLayout>(savedLayouts, { id: "", name: "", pitboxes: null });
  const { formRef, onSubmit, pending, result, errors } = useCatalogForm(
    (f) => saveCatalogTrack(instanceId, f),
    editing ? onDone : layouts.reset,
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      {editing && <input type="hidden" name="originalId" value={initial!.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Folder name" error={errors.id} hint={lockId ? "This folder is on the server, so its name stays." : "Exactly as in content\\tracks, e.g. ks_nordschleife"}>
          <IdInput defaultValue={initial?.id} locked={lockId} />
        </Field>
        <Field label="Display name" error={errors.name} hint="Optional, e.g. Nordschleife">
          <input className="field" name="name" defaultValue={initial?.name} maxLength={100} autoComplete="off" />
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
            {layouts.rows.map(({ key, value }) => (
              <div key={key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_7rem_2rem]">
                {value.id === "" && key < savedLayouts.length ? (
                  // The track's default layout (no sub-folder) next to named ones: its folder is empty on purpose.
                  <>
                    <input type="hidden" name="layoutId" value="" />
                    <span className="field truncate text-muted" title="The track's main layout, with no sub-folder">(no sub-folder)</span>
                  </>
                ) : (
                  <input className="field font-mono" name="layoutId" defaultValue={value.id} placeholder="layout folder" required maxLength={100} autoComplete="off" spellCheck={false} />
                )}
                <button type="button" className="btn sm:order-last" onClick={() => layouts.remove(key)} title="Remove layout">
                  ✕
                </button>
                <input className="field" name="layoutName" defaultValue={value.name} placeholder="Display name" maxLength={100} autoComplete="off" />
                <input className="field" name="layoutPitboxes" type="number" min={1} max={128} defaultValue={value.pitboxes ?? undefined} placeholder="Pits" />
              </div>
            ))}
            {(errors.layouts || errors.pitboxes) && <p className="text-sm text-danger">{errors.layouts ?? errors.pitboxes}</p>}
          </div>
        )}
        <button type="button" className="mt-2 text-sm text-accent hover:underline" onClick={layouts.add}>
          + Add a layout
        </button>
      </div>

      <Submit pending={pending} label={editing ? "Save changes" : "Add track"} result={result} onCancel={editing ? () => onDone?.() : undefined} />
    </form>
  );
}

/**
 * Edit and Remove for one hand-added entry in the lists. Edit opens the form underneath the entry
 * (the list item wraps, so `basis-full` puts it on its own line).
 */
export function EntryActions(
  props:
    | { instanceId: string; kind: "car"; entry: ManualCar; label: string; onServer: boolean; serverSkins: string[] }
    | { instanceId: string; kind: "track"; entry: ManualTrack; label: string; onServer: boolean; serverExtras: string[] },
) {
  const [editing, setEditing] = useState(false);
  const close = (result?: CatalogResult) => {
    setEditing(false);
    // Shown by <CatalogToast>: after a folder-name change this list item is replaced by a new one,
    // so a message kept here would vanish with it.
    if (result) announce(result.message);
  };
  return (
    <>
      <span className="flex gap-1.5">
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
        >
          {editing ? "Close" : "Edit"}
        </button>
        <RemoveEntryButton instanceId={props.instanceId} kind={props.kind} id={props.entry.id} label={props.label} />
      </span>
      {editing && (
        <div className="mt-2 basis-full rounded-lg border border-border bg-surface-2 p-4">
          {props.kind === "car" ? (
            <CarForm instanceId={props.instanceId} initial={props.entry} lockId={props.onServer} onDone={close} serverSkins={props.serverSkins} />
          ) : (
            <>
              {props.serverExtras.length > 0 && (
                <p className="mb-3 text-xs text-muted">Also found on the server (not editable here): {props.serverExtras.join(", ")}</p>
              )}
              <TrackForm instanceId={props.instanceId} initial={props.entry} lockId={props.onServer} onDone={close} />
            </>
          )}
        </div>
      )}
    </>
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

/** The folder-name input. Locked folders are sent as a hidden field and shown read-only. */
function IdInput({ defaultValue, locked }: { defaultValue?: string; locked?: boolean }) {
  if (locked) {
    return (
      <>
        <input type="hidden" name="id" value={defaultValue} />
        <input className="field font-mono text-muted" value={defaultValue} readOnly tabIndex={-1} aria-readonly />
      </>
    );
  }
  return <input className="field font-mono" name="id" defaultValue={defaultValue} required maxLength={100} autoComplete="off" spellCheck={false} />;
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

function Submit({ pending, label, result, onCancel }: { pending: boolean; label: string; result: CatalogResult | null; onCancel?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {onCancel && (
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      )}
      {result && !pending && <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
    </div>
  );
}

export function AddInUseButton({ instanceId }: { instanceId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await addInUseToCatalog(instanceId)))}
      >
        {pending ? "Adding…" : "Add them to the lists"}
      </button>
      {result && !pending && <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
    </div>
  );
}

const TOAST_EVENT = "catalog-toast";

function announce(message: string) {
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }));
}

/** A short-lived message in the corner of the page, for saves made in the list's edit forms. */
export function CatalogToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 10_000);
    };
    window.addEventListener(TOAST_EVENT, show);
    return () => {
      window.removeEventListener(TOAST_EVENT, show);
      clearTimeout(timer);
    };
  }, []);
  if (!message) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 flex items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg sm:left-auto sm:max-w-md">
      <span className="flex-1 text-ok">{message}</span>
      <button type="button" className="text-muted hover:text-fg" onClick={() => setMessage(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
