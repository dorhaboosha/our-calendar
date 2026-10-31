import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only: it checks that a session cookie exists, not that it is valid.
// The real check runs on the server in every protected page, action and route (requireUser).
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the public pages (login, privacy), API routes (they answer 401
  // themselves), Next.js internals and files with an extension (favicon, images).
  matcher: ["/((?!login|privacy|api|_next/static|_next/image|.*\\..*).*)"],
};
