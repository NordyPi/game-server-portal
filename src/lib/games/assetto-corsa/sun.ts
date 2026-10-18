// SUN_ANGLE in server_cfg.ini sets the time of day the server starts at.
// AssettoServer converts it with (AssettoServer.Shared/Weather/WeatherUtils.cs):
//   seconds  = angle * (50400 - 46800) / 16 + 46800
//   angle    = 16 * (seconds - 46800) / (50400 - 46800)
// i.e. 0° is 13:00 and every hour is 16°. Unmodded Assetto Corsa only shows 08:00–18:00
// (-80°…80°); with Custom Shaders Patch (CSP) any time of day works.
// Used by the settings form too, so no server-only imports here.

const NOON_ONE = 46800; // 13:00 in seconds
const SECONDS_PER_DEGREE = (50400 - 46800) / 16; // 225 s = 3¾ minutes

/** 00:00 and 23:56 (the last whole degree before midnight). */
export const SUN_ANGLE_MIN = -208;
export const SUN_ANGLE_MAX = 175;
/** What players without CSP can see: 08:00–18:00. */
export const VANILLA_MIN = -80;
export const VANILLA_MAX = 80;

/** "14:30" or "9:05" (24-hour) → seconds since midnight, or null. */
export function parseTime(text: string): number | null {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
}

/** Whole degrees, as Kunos' own tools write them (so the time snaps to 3¾-minute steps). */
export function sunAngleFromSeconds(seconds: number): number {
  const angle = Math.round((seconds - NOON_ONE) / SECONDS_PER_DEGREE);
  return Math.min(SUN_ANGLE_MAX, Math.max(SUN_ANGLE_MIN, angle));
}

export function secondsFromSunAngle(angle: number): number {
  return angle * SECONDS_PER_DEGREE + NOON_ONE;
}

/** Seconds → "HH:MM" (nearest minute, wrapped into one day). */
export function formatTime(seconds: number): string {
  const minutes = ((Math.round(seconds / 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
