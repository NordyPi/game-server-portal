import { IniFile } from "@/lib/ini";

// The grid (cfg/entry_list.ini) as the portal edits it: a list of rows, each "N slots of this car
// in this skin". Saved presets store the same rows. Used by the settings form too, so no
// server-only imports here.

/** skin "" = automatic: cycle through the car's known skins, or the default skin if none are known. */
export type EntryRow = { car: string; skin: string; count: number };
/** One [CAR_n] section. */
export type Slot = { model: string; skin: string };

export function totalSlots(rows: EntryRow[]) {
  return rows.reduce((n, r) => n + r.count, 0);
}

/** The cars a grid uses, in the order they first appear (for CARS= in server_cfg.ini). */
export function carsOf(rows: EntryRow[]) {
  return [...new Set(rows.map((r) => r.car))];
}

/** Expands rows into slots. Automatic skins keep cycling across all rows of the same car. */
export function slotsFor(rows: EntryRow[], skinsOf: (car: string) => string[]): Slot[] {
  const cycle = new Map<string, number>();
  return rows.flatMap((row) =>
    Array.from({ length: row.count }, () => {
      if (row.skin) return { model: row.car, skin: row.skin };
      const skins = skinsOf(row.car);
      const n = cycle.get(row.car) ?? 0;
      cycle.set(row.car, n + 1);
      return { model: row.car, skin: skins.length ? skins[n % skins.length] : "" };
    }),
  );
}

export function buildEntryList(slots: Slot[]): string {
  return slots
    .flatMap((s, i) => [
      `[CAR_${i}]`, `MODEL=${s.model}`, `SKIN=${s.skin}`, "SPECTATOR_MODE=0", "DRIVERNAME=", "TEAM=", "GUID=", "BALLAST=0", "RESTRICTOR=0", "",
    ])
    .join("\n");
}

export function parseEntryList(text: string): Slot[] {
  if (!text.trim()) return [];
  const ini = new IniFile(text);
  return ini
    .sections()
    .filter((s) => /^CAR_\d+$/.test(s))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .map((s) => ({ model: ini.get(s, "MODEL") ?? "", skin: ini.get(s, "SKIN") ?? "" }))
    .filter((s) => s.model);
}

/**
 * Existing entry list → rows for the form: one row per car. If every slot of a car uses the same
 * skin that skin is kept, otherwise the row is "automatic" (and slotsSatisfy() then accepts the
 * existing mix, so saving without changes doesn't rewrite the file).
 */
export function rowsFromSlots(slots: Slot[]): EntryRow[] {
  const rows = new Map<string, { skins: Set<string>; count: number }>();
  for (const s of slots) {
    const row = rows.get(s.model) ?? { skins: new Set(), count: 0 };
    row.skins.add(s.skin);
    row.count++;
    rows.set(s.model, row);
  }
  return [...rows].map(([car, r]) => ({ car, skin: r.skins.size === 1 ? [...r.skins][0] : "", count: r.count }));
}

/**
 * Does the existing entry list already match these rows? Same cars, same number of slots each,
 * every chosen skin present; automatic rows accept any skin. When it matches we leave the file
 * alone, so hand edits to it (AI traffic slots, ballast…) survive changing the track.
 */
export function slotsSatisfy(existing: Slot[], rows: EntryRow[]): boolean {
  if (existing.length !== totalSlots(rows)) return false;
  const remaining = new Map<string, string[]>();
  for (const s of existing) remaining.set(s.model, [...(remaining.get(s.model) ?? []), s.skin]);

  const automatic = new Map<string, number>();
  for (const row of rows) {
    if (!row.skin) {
      automatic.set(row.car, (automatic.get(row.car) ?? 0) + row.count);
      continue;
    }
    const skins = remaining.get(row.car) ?? [];
    for (let i = 0; i < row.count; i++) {
      const at = skins.indexOf(row.skin);
      if (at < 0) return false;
      skins.splice(at, 1);
    }
    remaining.set(row.car, skins);
  }
  return [...remaining].every(([car, skins]) => skins.length === (automatic.get(car) ?? 0));
}
