import { createHash, timingSafeEqual } from "node:crypto";
import { runExportsNow } from "@/modules/google-export/trigger";

const NO_STORE = { "Cache-Control": "no-store" };
/** A shorter CRON_SECRET is treated as not set: it would be too easy to guess. */
const MIN_SECRET_LENGTH = 32;

/**
 * POST /api/jobs/run, with "Authorization: Bearer <CRON_SECRET>".
 * Runs the export jobs that are due. Called every 30 minutes by GitHub Actions
 * (.github/workflows/export-jobs.yml), so retries happen even when nobody uses the app.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return Response.json({ error: "not configured" }, { status: 503, headers: NO_STORE });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const ran = await runExportsNow();
  return Response.json({ ran }, { headers: NO_STORE });
}

/** Compares in constant time; hashing first makes both sides the same length. */
function authorized(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(secret));
}
