import { NextResponse } from "next/server";

/**
 * A redirect from a route handler to a path of this site. The Location is relative, so
 * the browser resolves it against the address it is on: behind Render's proxy, a route
 * handler's request.url has the server's internal address (https://localhost:10000), and
 * an absolute URL built from it would send the browser there. Cookies can still be set
 * on the response.
 */
export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
