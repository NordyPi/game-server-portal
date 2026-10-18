import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { fontVariables } from "./fonts";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Game Servers", template: "%s · Game Servers" },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={fontVariables}>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <Link href="/" className="font-display text-lg font-bold tracking-wide">
              <span className="text-accent">▶</span> Game Servers
            </Link>
            {user && <span className="ml-auto truncate text-sm text-muted">{user.name}</span>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
