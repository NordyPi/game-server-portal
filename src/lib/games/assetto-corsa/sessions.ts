import { z } from "zod";
import type { IniFile } from "@/lib/ini";

// The server's events: [PRACTICE], [QUALIFY] and [RACE] in server_cfg.ini.
//   enabled  → the section exists; switching an event off removes its section
//   TIME     → minutes (practice, qualify); races always run by laps here, so the race's TIME is 0
//   IS_OPEN  → can players join during it: 0 closed, 1 open, 2 open until the session starts
//   LAPS     → race laps
// AssettoServer reads these in Server/Configuration/Kunos/SessionConfiguration.cs.
// Used by the settings form too (types only), so no server-only imports here.

/** IS_OPEN: 0 = closed, 1 = open, 2 = open until the session starts. */
export type JoinMode = 0 | 1 | 2;
export type TimedSession = { enabled: boolean; minutes: number; canJoin: boolean };
export type RaceSession = { enabled: boolean; laps: number; join: JoinMode };
export type Sessions = { practice: TimedSession; qualify: TimedSession; race: RaceSession };

export const MAX_MINUTES = 1440;
export const MAX_LAPS = 999;

/** Used when an event has never been set up (your sample config's values). */
export const DEFAULT_SESSIONS: Sessions = {
  practice: { enabled: false, minutes: 30, canJoin: true },
  qualify: { enabled: false, minutes: 5, canJoin: true },
  race: { enabled: false, laps: 5, join: 1 },
};

const timedSchema = z.object({ enabled: z.boolean(), minutes: z.number(), canJoin: z.boolean() });
export const sessionsSchema = z.object({
  practice: timedSchema,
  qualify: timedSchema,
  race: z.object({ enabled: z.boolean(), laps: z.number(), join: z.union([z.literal(0), z.literal(1), z.literal(2)]) }),
});

/**
 * Reads the three events. An event without a section is "off"; its boxes show `remembered` values
 * (what it had the last time it was on, kept by the portal) or the defaults.
 */
export function readSessions(ini: IniFile, remembered?: Sessions): Sessions {
  const fallback = remembered ?? DEFAULT_SESSIONS;
  const int = (section: string, key: string) => {
    const v = ini.get(section, key) ?? "";
    return /^\d+$/.test(v) ? Number(v) : null;
  };
  const timed = (section: string, fb: TimedSession): TimedSession => {
    if (!ini.hasSection(section)) return { ...fb, enabled: false };
    const minutes = int(section, "TIME");
    return { enabled: true, minutes: minutes && minutes > 0 ? minutes : fb.minutes, canJoin: int(section, "IS_OPEN") !== 0 };
  };
  const race = (): RaceSession => {
    if (!ini.hasSection("RACE")) return { ...fallback.race, enabled: false };
    const laps = int("RACE", "LAPS");
    const open = int("RACE", "IS_OPEN");
    return {
      enabled: true,
      laps: laps && laps > 0 ? laps : fallback.race.laps,
      // AssettoServer treats a missing IS_OPEN as open.
      join: open === 0 || open === 2 ? open : 1,
    };
  };
  return { practice: timed("PRACTICE", fallback.practice), qualify: timed("QUALIFY", fallback.qualify), race: race() };
}

/** An error message, or undefined when the events are fine. Only events that are on are checked. */
export function validateSessions(s: Sessions): string | undefined {
  if (!s.practice.enabled && !s.qualify.enabled && !s.race.enabled) {
    return "Turn on at least one event: the server needs one to run.";
  }
  const minutesOk = (m: number) => Number.isInteger(m) && m >= 1 && m <= MAX_MINUTES;
  if (s.practice.enabled && !minutesOk(s.practice.minutes)) return `Practice: a whole number of minutes, 1 to ${MAX_MINUTES}.`;
  if (s.qualify.enabled && !minutesOk(s.qualify.minutes)) return `Qualify: a whole number of minutes, 1 to ${MAX_MINUTES}.`;
  if (s.race.enabled && !(Number.isInteger(s.race.laps) && s.race.laps >= 1 && s.race.laps <= MAX_LAPS)) {
    return `Race: a whole number of laps, 1 to ${MAX_LAPS}.`;
  }
  if (![0, 1, 2].includes(s.race.join)) return "Race: pick who can join.";
}

/**
 * Writes the events. Existing sections only get TIME / IS_OPEN / LAPS changed (anything else in
 * them, like WAIT_TIME, stays); a switched-on event gets a new section, in Practice → Qualify → Race
 * order; a switched-off event's section is removed.
 */
export function writeSessions(ini: IniFile, s: Sessions) {
  const timed = (section: string, name: string, e: TimedSession, place: { before?: string[]; after?: string[] }) => {
    if (!e.enabled) return ini.removeSection(section);
    const open = e.canJoin ? "1" : "0";
    if (ini.hasSection(section)) {
      ini.set(section, "TIME", String(e.minutes));
      ini.set(section, "IS_OPEN", open);
    } else {
      ini.addSection(section, [["NAME", name], ["TIME", String(e.minutes)], ["IS_OPEN", open]], place);
    }
  };
  timed("PRACTICE", "Practice", s.practice, { before: ["QUALIFY", "RACE"] });
  timed("QUALIFY", "Qualify", s.qualify, { before: ["RACE"], after: ["PRACTICE"] });

  if (!s.race.enabled) return ini.removeSection("RACE");
  if (ini.hasSection("RACE")) {
    ini.set("RACE", "TIME", "0"); // races run by laps
    ini.set("RACE", "LAPS", String(s.race.laps));
    ini.set("RACE", "IS_OPEN", String(s.race.join));
  } else {
    ini.addSection(
      "RACE",
      [["NAME", "Race"], ["TIME", "0"], ["IS_OPEN", String(s.race.join)], ["WAIT_TIME", "15"], ["LAPS", String(s.race.laps)]],
      { after: ["QUALIFY", "PRACTICE"] },
    );
  }
}

export const JOIN_LABELS: Record<JoinMode, string> = { 0: "Closed", 1: "Open", 2: "Until start" };

/** "Practice 30 min · Race 5 laps": the events that are on. */
export function describeSessions(s: Sessions): string {
  return [
    s.practice.enabled && `Practice ${s.practice.minutes} min`,
    s.qualify.enabled && `Qualify ${s.qualify.minutes} min`,
    s.race.enabled && `Race ${s.race.laps} laps`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What changed, for "Recent changes": ["practice off", "race 7 laps", …]. */
export function sessionChanges(before: Sessions, after: Sessions): string[] {
  const out: string[] = [];
  for (const [key, label] of [["practice", "practice"], ["qualify", "qualify"]] as const) {
    const b = before[key], a = after[key];
    if (b.enabled !== a.enabled) out.push(a.enabled ? `${label} on (${a.minutes} min)` : `${label} off`);
    else if (a.enabled) {
      if (b.minutes !== a.minutes) out.push(`${label} ${a.minutes} min`);
      if (b.canJoin !== a.canJoin) out.push(`${label} ${a.canJoin ? "open" : "closed"} to joining`);
    }
  }
  const b = before.race, a = after.race;
  if (b.enabled !== a.enabled) out.push(a.enabled ? `race on (${a.laps} laps)` : "race off");
  else if (a.enabled) {
    if (b.laps !== a.laps) out.push(`race ${a.laps} laps`);
    if (b.join !== a.join) out.push(`race joining: ${JOIN_LABELS[a.join].toLowerCase()}`);
  }
  return out;
}
