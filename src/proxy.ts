import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_HEADER, verifyAccessToken } from "@/lib/access";

/** First gate: every request must carry a valid Cloudflare Access token. Pages and actions check again. */
export async function proxy(request: NextRequest) {
  const user = await verifyAccessToken(request.headers.get(ACCESS_HEADER));
  if (!user) return new NextResponse("Not signed in. Open this site through its Cloudflare address.", { status: 403 });
}

export const config = {
  // Skip Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
