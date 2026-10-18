"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { getInstance } from "@/lib/config";
import { getContent } from "@/lib/games/assetto-corsa/catalog";
import { entryRowSchema } from "@/lib/games/assetto-corsa/entry-presets";
import { readServerCfg, startTimeOf, validateSettings, writeSettings, type ValidationErrors } from "@/lib/games/assetto-corsa/server-config";
import { withInstanceLock } from "@/lib/locks";
import { controlService, type ServiceAction } from "@/lib/service";
import { requireUser } from "@/lib/session";

export type ActionResult = { ok: boolean; message: string };

const pastTense: Record<ServiceAction, string> = { start: "started", stop: "stopped", restart: "restarted" };

export async function controlServer(instanceId: string, action: ServiceAction): Promise<ActionResult> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (!instance || !(action in pastTense)) return { ok: false, message: "Unknown server or action." };

  try {
    await withInstanceLock(instance.id, () => controlService(instance.unit, action));
  } catch (err) {
    return { ok: false, message: `Couldn't ${action} the server: ${err instanceof Error ? err.message : err}` };
  }
  await logActivity({ instanceId: instance.id, user: user.name, message: `${pastTense[action]} the server` });
  revalidatePath("/", "layout");
  return { ok: true, message: `Server ${pastTense[action]}.` };
}

export type ApplyState = { ok: boolean; message: string; errors: ValidationErrors } | null;

export async function applyAssettoSettings(instanceId: string, _prev: ApplyState, form: FormData): Promise<ApplyState> {
  const user = await requireUser();
  const instance = getInstance(instanceId);
  if (instance?.game !== "assetto-corsa") return { ok: false, message: "Unknown server.", errors: {} };

  const text = (key: string) => String(form.get(key) ?? "");
  // The grid comes as JSON from a hidden field; check its shape before anything else looks at it.
  const entries = z.array(entryRowSchema).safeParse(parseJson(text("entries")));
  if (!entries.success) return { ok: false, message: "The grid didn't come through. Reload the page and try again.", errors: {} };

  const content = await getContent(instance);
  const result = validateSettings(
    {
      name: text("name"),
      password: text("password"),
      track: text("track"),
      layout: text("layout"),
      entries: entries.data,
      damage: Number(text("damage")),
      tyreWear: Number(text("tyreWear")),
      raceLaps: form.has("raceLaps") ? Number(text("raceLaps")) : null,
      startTime: text("startTime"),
    },
    content,
  );
  if (!result.ok) return { ok: false, message: "Fix the fields marked in red.", errors: result.errors };
  const settings = result.settings;

  try {
    const before = await readServerCfg(instance.dir);
    if (!before) return { ok: false, message: "cfg/server_cfg.ini is missing on the server.", errors: {} };
    await withInstanceLock(instance.id, async () => {
      await writeSettings(instance.dir, settings, content);
      await controlService(instance.unit, "restart");
    });

    const track = content.tracks.find((t) => t.id === settings.track)!;
    const layout = track.layouts.find((l) => l.id === settings.layout)!;
    const changes: string[] = [];
    if (before.settings.track !== settings.track || before.settings.layout !== settings.layout) {
      // Kunos layout names already include the track ("Nordschleife - Endurance"); hand-added ones may not.
      const trackText =
        track.layouts.length < 2 ? track.name
        : layout.name.startsWith(track.name) ? layout.name
        : `${track.name} – ${layout.name}`;
      changes.push(`track → ${trackText}`);
    }
    if (JSON.stringify(before.settings.entries) !== JSON.stringify(settings.entries)) {
      const carName = (id: string) => content.cars.find((c) => c.id === id)?.name ?? id;
      changes.push(`grid → ${settings.entries.map((r) => `${r.count}× ${carName(r.car)}${r.skin ? ` (${r.skin})` : ""}`).join(", ")}`);
    }
    if (before.settings.damage !== settings.damage) changes.push(`damage ${settings.damage}%`);
    if (before.settings.tyreWear !== settings.tyreWear) changes.push(`tyre wear ${settings.tyreWear}%`);
    if (before.settings.raceLaps !== settings.raceLaps && settings.raceLaps !== null) changes.push(`${settings.raceLaps} race laps`);
    if (before.settings.sunAngle !== settings.sunAngle) changes.push(`start time ${startTimeOf(settings.sunAngle)}`);
    if (before.settings.name !== settings.name) changes.push(`name → "${settings.name}"`);
    if (before.settings.password !== settings.password) changes.push(settings.password ? "changed the password" : "removed the password");
    await logActivity({
      instanceId: instance.id,
      user: user.name,
      message: changes.length ? `applied ${changes.join("; ")}` : "re-applied the settings",
    });
  } catch (err) {
    return { ok: false, message: `Saving or restarting failed: ${err instanceof Error ? err.message : err}`, errors: {} };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The server is restarting with the new settings.", errors: {} };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
