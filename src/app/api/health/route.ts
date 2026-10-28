import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

// Render's health check: the app is up and can reach the database.
// Public, so it reveals nothing beyond ok / not ok.
export async function GET() {
  // Run on every request. Without request-time data, Cache Components would
  // prerender this handler once at build time.
  await connection();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Health check: database unreachable", error);
    return Response.json(
      { status: "error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
