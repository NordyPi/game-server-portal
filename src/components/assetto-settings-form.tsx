"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import { applyAssettoSettings, type ApplyState } from "@/app/actions";
import { deleteEntryPreset, saveEntryPreset } from "@/app/preset-actions";
import type { Track } from "@/lib/games/assetto-corsa/content";
import { totalSlots, type EntryRow } from "@/lib/games/assetto-corsa/entries";
import type { AcSettings } from "@/lib/games/assetto-corsa/server-config";
import { formatTime, parseTime, secondsFromSunAngle, sunAngleFromSeconds, VANILLA_MAX, VANILLA_MIN } from "@/lib/games/assetto-corsa/sun";

type CarOption = { id: string; name: string; brand: string; skins: string[] };
type PresetOption = { name: string; entries: EntryRow[]; savedBy: string; savedAt: string };
type Row = EntryRow & { key: number };

// Row keys only need to be unique within the page.
let keySeq = 0;
const newKey = () => keySeq++;
const toRows = (entries: EntryRow[]): Row[] => entries.map((e) => ({ ...e, key: newKey() }));

export function AssettoSettingsForm({
  instanceId,
  current,
  cars,
  tracks,
  presets,
}: {
  instanceId: string;
  current: AcSettings;
  cars: CarOption[];
  tracks: Track[];
  presets: PresetOption[];
}) {
  const [state, formAction, pending] = useActionState<ApplyState, FormData>(applyAssettoSettings.bind(null, instanceId), null);

  const carById = useMemo(() => new Map(cars.map((c) => [c.id, c])), [cars]);
  const currentTrackInstalled = tracks.some((t) => t.id === current.track && t.layouts.some((l) => l.id === current.layout));

  const [name, setName] = useState(current.name);
  const [password, setPassword] = useState(current.password);
  const [trackId, setTrackId] = useState(currentTrackInstalled ? current.track : "");
  const [layoutId, setLayoutId] = useState(currentTrackInstalled ? current.layout : "");
  const [rows, setRows] = useState<Row[]>(() => toRows(current.entries));
  const [damage, setDamage] = useState(current.damage);
  // Kept as text while typing (like race laps) so "-" and an empty box are possible.
  const [trackTemp, setTrackTemp] = useState(String(current.trackTemp));
  const [airTemp, setAirTemp] = useState(String(current.airTemp));
  const [tyreWear, setTyreWear] = useState(current.tyreWear);
  const [raceLaps, setRaceLaps] = useState(current.raceLaps === null ? null : String(current.raceLaps));
  const [startTime, setStartTime] = useState(formatTime(secondsFromSunAngle(current.sunAngle)));
  const [cspVersion, setCspVersion] = useState(current.cspVersion === null ? "" : String(current.cspVersion));

  const track = tracks.find((t) => t.id === trackId);
  const layout = track?.layouts.find((l) => l.id === layoutId);
  const errors = state?.errors ?? {};
  const total = totalSlots(rows);
  const tooMany = layout?.pitboxes != null && total > layout.pitboxes;
  const missingCars = [...new Set(rows.filter((r) => !carById.has(r.car)).map((r) => r.car))];

  function pickTrack(id: string) {
    setTrackId(id);
    setLayoutId(tracks.find((x) => x.id === id)?.layouts[0]?.id ?? "");
  }

  const updateRow = (key: number, patch: Partial<EntryRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form
      // Submitted by hand rather than with `action=`: React resets a form after its action finishes,
      // which would show stale values in these controlled fields.
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm("Save and restart the server? Anyone driving right now will be disconnected.")) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-8"
    >
      {/* ---- Track ---- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Track" error={errors.track}>
          <select className="field" name="track" value={trackId} onChange={(e) => pickTrack(e.target.value)} required>
            {!trackId && <option value="">— pick a track —</option>}
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.layouts.length > 1 ? ` (${t.layouts.length} layouts)` : ""}
              </option>
            ))}
          </select>
          {!currentTrackInstalled && current.track && (
            <Hint warn>The server is set to “{current.track}{current.layout ? ` / ${current.layout}` : ""}”, which isn’t in the track list.</Hint>
          )}
        </Field>

        <Field label="Layout" error={errors.layout}>
          <select className="field" name="layout" value={layoutId} onChange={(e) => setLayoutId(e.target.value)} disabled={!track || track.layouts.length < 2}>
            {(track?.layouts ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {/* A disabled select isn't submitted, so send the single layout explicitly. */}
          {track && track.layouts.length < 2 && <input type="hidden" name="layout" value={layoutId} />}
          {layout?.pitboxes && <Hint>{layout.pitboxes} pit boxes</Hint>}
        </Field>

        <Field label="Requires CSP build" error={errors.cspVersion}>
          <input
            className="field font-mono"
            type="number"
            name="cspVersion"
            min={1}
            max={99999}
            step={1}
            value={cspVersion}
            onChange={(e) => setCspVersion(e.target.value)}
            placeholder="not required"
          />
          <input type="hidden" name="cspExtra" value={current.cspExtra} />
          <Hint>
            {cspVersion
              ? `Players need Custom Shaders Patch build ${cspVersion} or newer to join. Leave empty to let anyone join.`
              : "Anyone can join. Enter a CSP build number (like 4116) to require Custom Shaders Patch."}
          </Hint>
        </Field>
      </div>

      {/* ---- Grid ---- */}
      <fieldset className="space-y-3">
        <legend className="mb-2 font-display text-base font-bold">Grid</legend>
        <PresetBar instanceId={instanceId} presets={presets} rows={rows} onLoad={(entries) => setRows(toRows(entries))} />

        <input type="hidden" name="entries" value={JSON.stringify(rows.map(({ car, skin, count }) => ({ car, skin, count })))} />
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">No cars yet. Add some from the list below, or load a preset.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => {
              const car = carById.get(row.car);
              const skins = car?.skins ?? [];
              return (
                <li key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_14rem_6rem_auto]">
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-semibold ${car ? "" : "text-danger"}`}>{car?.name ?? row.car}</div>
                    {!car && <div className="text-xs text-danger">not in the car list</div>}
                  </div>
                  <div className="flex gap-1 sm:order-last">
                    <button type="button" className="btn px-2 py-1" title="Add another row of this car (e.g. a different skin)" onClick={() => setRows((rs) => rs.flatMap((r) => (r.key === row.key ? [r, { ...r, skin: "", count: 1, key: newKey() }] : [r])))}>
                      +
                    </button>
                    <button type="button" className="btn px-2 py-1" title="Remove" onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                      ✕
                    </button>
                  </div>
                  <select className="field py-1.5 text-sm" value={row.skin} onChange={(e) => updateRow(row.key, { skin: e.target.value })} aria-label="Skin">
                    <option value="">{skins.length ? "Mix of all skins" : "Default skin"}</option>
                    {skins.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {row.skin && !skins.includes(row.skin) && <option value={row.skin}>{row.skin}</option>}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      className="field w-16 py-1.5 text-sm"
                      type="number"
                      min={1}
                      max={128}
                      value={row.count}
                      onChange={(e) => updateRow(row.key, { count: Math.max(1, Math.min(128, Math.floor(Number(e.target.value) || 1))) })}
                      aria-label="Slots"
                    />
                    <span className="text-muted">slots</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className={`text-sm ${tooMany ? "text-danger" : "text-muted"}`}>
          {total} {total === 1 ? "slot" : "slots"} in total{layout?.pitboxes ? ` · this layout has ${layout.pitboxes} pit boxes` : ""}
        </p>
        {missingCars.length > 0 && <Hint warn>Remove the red cars, or add them on the Cars &amp; tracks page.</Hint>}
        {errors.entries && <p className="text-sm text-danger">{errors.entries}</p>}

        <CarPicker cars={cars} rows={rows} onAdd={(id) => setRows((rs) => [...rs, { car: id, skin: "", count: 1, key: newKey() }])} />
      </fieldset>

      {/* ---- Session ---- */}
      <fieldset>
        <legend className="mb-3 font-display text-base font-bold">Session</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Slider label="Damage" name="damage" value={damage} onChange={setDamage} error={errors.damage} left="No damage" right="Full damage" />
          <Slider label="Tyre wear" name="tyreWear" value={tyreWear} onChange={setTyreWear} error={errors.tyreWear} left="No wear" right="Normal wear" />
          <Field label="Air temperature (°C)" error={errors.airTemp}>
            <input className="field" type="number" name="airTemp" min={-20} max={50} step={1} value={airTemp} onChange={(e) => setAirTemp(e.target.value)} required />
          </Field>
          <Field label="Track: degrees above air" error={errors.trackTemp}>
            <input className="field" type="number" name="trackTemp" min={-10} max={30} step={1} value={trackTemp} onChange={(e) => setTrackTemp(e.target.value)} required />
            {/* AssettoServer: road temperature = air temperature + this number. */}
            {airTemp !== "" && trackTemp !== "" && Number.isFinite(Number(airTemp) + Number(trackTemp)) && (
              <Hint>Track ≈ {Number(airTemp) + Number(trackTemp)} °C</Hint>
            )}
          </Field>
          <Field label="Race laps" error={errors.raceLaps}>
            {raceLaps === null ? (
              <p className="text-sm text-muted">This server has no race session (only practice/free-roam), so there are no laps to set.</p>
            ) : (
              <input className="field" type="number" name="raceLaps" min={1} max={999} step={1} value={raceLaps} onChange={(e) => setRaceLaps(e.target.value)} required />
            )}
          </Field>
          <Field label="Start time (24-hour)" error={errors.startTime}>
            <input
              className="field font-mono"
              name="startTime"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="14:30"
              inputMode="numeric"
              pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
              title="24-hour time, like 14:30"
              required
            />
            <StartTimeHint text={startTime} />
          </Field>
        </div>
      </fieldset>

      {/* ---- Server ---- */}
      <fieldset>
        <legend className="mb-3 font-display text-base font-bold">Server</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Server name" error={errors.name}>
            <input className="field" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          <Field label="Password" error={errors.password}>
            <input className="field" name="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={50} placeholder="none" autoComplete="off" />
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending || !track || rows.length === 0 || tooMany}>
          {pending ? "Saving & restarting…" : "Save & restart server"}
        </button>
        {state && !pending && <p className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>}
      </div>
    </form>
  );
}

/** Load / save / delete saved grids. */
function PresetBar({ instanceId, presets, rows, onLoad }: { instanceId: string; presets: PresetOption[]; rows: EntryRow[]; onLoad: (entries: EntryRow[]) => void }) {
  const [selected, setSelected] = useState("");
  const [saveName, setSaveName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startPresetTransition] = useTransition();

  function load(name: string) {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    if (rows.length && !confirm(`Replace the current grid with “${name}”?`)) return;
    setSelected(name);
    setSaveName(name);
    onLoad(preset.entries);
    setMessage({ ok: true, text: `Loaded “${name}”. Hit Save & restart to use it.` });
  }

  function save() {
    const name = saveName.trim();
    if (presets.some((p) => p.name.toLowerCase() === name.toLowerCase()) && !confirm(`Overwrite the preset “${name}”?`)) return;
    startPresetTransition(async () => {
      const r = await saveEntryPreset(instanceId, name, rows.map(({ car, skin, count }) => ({ car, skin, count })));
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) setSelected(name);
    });
  }

  function remove() {
    if (!selected || !confirm(`Delete the preset “${selected}”?`)) return;
    startPresetTransition(async () => {
      const r = await deleteEntryPreset(instanceId, selected);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) setSelected("");
    });
  }

  const info = presets.find((p) => p.name === selected);
  return (
    <div className="space-y-2 rounded-lg bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="field w-auto min-w-48 flex-1 py-1.5 text-sm" value={selected} onChange={(e) => load(e.target.value)} aria-label="Load a preset">
          <option value="">{presets.length ? "Load a saved grid…" : "No saved grids yet"}</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({totalSlots(p.entries)} slots)
            </option>
          ))}
        </select>
        {selected && (
          <button type="button" className="btn btn-danger py-1.5 text-xs" onClick={remove} disabled={pending}>
            Delete preset
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field w-auto min-w-48 flex-1 py-1.5 text-sm"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name this grid, e.g. Drift night"
          maxLength={60}
          aria-label="Preset name"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (saveName.trim() && rows.length) save();
            }
          }}
        />
        <button type="button" className="btn py-1.5 text-xs" onClick={save} disabled={pending || !saveName.trim() || rows.length === 0}>
          {pending ? "Saving…" : "Save grid as preset"}
        </button>
      </div>
      {message && <p className={`text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
      {info && !message && <p className="text-xs text-muted">Saved by {info.savedBy}</p>}
    </div>
  );
}

function CarPicker({ cars, rows, onAdd }: { cars: CarOption[]; rows: EntryRow[]; onAdd: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = q ? cars.filter((c) => `${c.name} ${c.brand} ${c.id}`.toLowerCase().includes(q)) : cars;
  return (
    <div>
      <input className="field mb-2" type="search" placeholder={`Add a car: search ${cars.length} cars…`} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {visible.length === 0 && <p className="p-3 text-sm text-muted">No cars match. New mod? Add it on the Cars &amp; tracks page.</p>}
        {visible.map((c) => {
          const inGrid = rows.filter((r) => r.car === c.id).reduce((n, r) => n + r.count, 0);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onAdd(c.id)}
              className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2"
            >
              <span className="font-bold text-accent">+</span>
              <span className="flex-1">{c.name}</span>
              {inGrid > 0 && <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-fg">{inGrid} in grid</span>}
              <span className="hidden text-xs text-muted sm:inline">{c.brand || c.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Slider({ label, name, value, onChange, error, left, right }: { label: string; name: string; value: number; onChange: (v: number) => void; error?: string; left: string; right: string }) {
  return (
    <Field label={`${label}: ${value}%`} error={error}>
      <input className="w-full accent-(--accent)" type="range" name={name} min={0} max={100} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="flex justify-between text-xs text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </Field>
  );
}

function StartTimeHint({ text }: { text: string }) {
  const seconds = parseTime(text);
  if (seconds === null) return <Hint>For example 08:00 or 14:30.</Hint>;
  const angle = sunAngleFromSeconds(seconds);
  const actual = formatTime(secondsFromSunAngle(angle));
  const formatted = formatTime(seconds);
  return (
    <>
      <Hint>
        SUN_ANGLE={angle}
        {actual !== formatted ? ` · the game only does 3¾-minute steps, so it starts at ${actual}` : ""}
      </Hint>
      {(angle < VANILLA_MIN || angle > VANILLA_MAX) && (
        <Hint warn>Outside 08:00–18:00: everyone needs Custom Shaders Patch (CSP) to see this time.</Hint>
      )}
    </>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">{label}</div>
      {children}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

function Hint({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <p className={`mt-1 text-xs ${warn ? "text-warn" : "text-muted"}`}>{children}</p>;
}
