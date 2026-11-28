import { connection } from "next/server";

// Render's health check: the app's process is up and answering. It doesn't touch the
// database: Render calls it every few seconds while the service is awake, and a query
// each time would keep Neon's compute from ever scaling to zero, using up the free
// plan's compute hours (docs/operations.md). Public, so it reveals nothing beyond ok.
export async function GET() {
  // Run on every request. Without request-time data, Cache Components would
  // prerender this handler once at build time.
  await connection();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
