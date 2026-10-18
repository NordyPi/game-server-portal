import { createRemoteJWKSet, jwtVerify } from "jose";

// Sign-in is handled entirely by Cloudflare Access: friends log in with a one-time code sent to
// their email, and Cloudflare adds a signed JWT to every request it forwards through the tunnel.
// We verify that JWT ourselves so nothing reaching the portal by another route gets in.
//
// No "server-only" import here: this file is also used by src/proxy.ts.

export const ACCESS_HEADER = "cf-access-jwt-assertion";

export type AccessUser = { email: string };

const DEV_USER: AccessUser = { email: "dev@localhost" };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeam = "";

function accessSettings() {
  const team = (process.env.CF_ACCESS_TEAM_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = process.env.CF_ACCESS_AUD ?? "";
  return team && aud ? { team, aud } : null;
}

/**
 * Returns the signed-in user, or null.
 * In development (`npm run dev`) without Cloudflare settings everyone is "dev@localhost".
 * In production missing settings mean nobody gets in.
 */
export async function verifyAccessToken(token: string | null | undefined): Promise<AccessUser | null> {
  const settings = accessSettings();
  if (!settings) return process.env.NODE_ENV === "production" ? null : DEV_USER;
  if (!token) return null;

  if (!jwks || jwksTeam !== settings.team) {
    jwks = createRemoteJWKSet(new URL(`https://${settings.team}/cdn-cgi/access/certs`));
    jwksTeam = settings.team;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${settings.team}`,
      audience: settings.aud,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    return email ? { email } : null;
  } catch {
    return null;
  }
}
