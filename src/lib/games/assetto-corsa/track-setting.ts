// TRACK= in server_cfg.ini is usually just the track's folder name, but Content Manager's
// "Require CSP to join" writes it as a path that requires a minimum Custom Shaders Patch build:
//   TRACK=csp/4116/../D/../fn_nurburgring
//   TRACK=csp/2053/../shuto_revival_project_beta
// Players without that CSP build can't join. The path resolves to content/tracks/csp/<track>, which
// is where such a track's server files live. Extra segments ("D/../") are CM options we keep as is.
// Used by the settings form too, so no server-only imports here.

export type TrackSetting = {
  track: string;
  /** Minimum CSP build players need, or null when not required. */
  cspVersion: number | null;
  /** Content Manager's extra segments between the version and the track, e.g. "D/../". */
  cspExtra: string;
};

const CSP_TRACK = /^csp\/(\d+)\/\.\.\/((?:[^/]+\/\.\.\/)*)([^/]+)$/;

export function parseTrackSetting(raw: string): TrackSetting {
  const m = CSP_TRACK.exec(raw.trim());
  if (!m) return { track: raw.trim(), cspVersion: null, cspExtra: "" };
  return { track: m[3], cspVersion: Number(m[1]), cspExtra: m[2] };
}

export function formatTrackSetting({ track, cspVersion, cspExtra }: TrackSetting): string {
  return cspVersion === null ? track : `csp/${cspVersion}/../${cspExtra}${track}`;
}
