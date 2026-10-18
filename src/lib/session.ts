import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ACCESS_HEADER, verifyAccessToken } from "@/lib/access";
import { getConfig } from "@/lib/config";

export type CurrentUser = { email: string; name: string };

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await verifyAccessToken((await headers()).get(ACCESS_HEADER));
  if (!user) return null;
  return { email: user.email, name: displayName(user.email) };
});

/** Use in pages, Server Actions and Route Handlers (Server Actions are reachable by direct POST). */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) notFound();
  return user;
}

export function displayName(email: string) {
  return getConfig().users[email] ?? email.split("@")[0];
}
