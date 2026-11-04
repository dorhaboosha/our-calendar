import { appConfig } from "@/config/app.config";
import { getCurrentUser } from "@/modules/auth/current-user";
import { MAX_RANGE_DAYS, listEvents } from "@/modules/events/events";

const NO_STORE = { "Cache-Control": "no-store" };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/events?start=<ISO instant>&end=<ISO instant>
 * The events overlapping [start, end), for the calendar on screen. Signed-in users only.
 */
export async function GET(request: Request) {
  // Reading the session also makes this run on every request (never prerendered).
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  const params = new URL(request.url).searchParams;
  const start = parseInstant(params.get("start"));
  const end = parseInstant(params.get("end"));
  if (
    !start ||
    !end ||
    end <= start ||
    end.getTime() - start.getTime() > MAX_RANGE_DAYS * MS_PER_DAY
  ) {
    return Response.json({ error: "invalid range" }, { status: 400, headers: NO_STORE });
  }

  const events = await listEvents(start, end, appConfig.timeZone);
  return Response.json({ events }, { headers: NO_STORE });
}

/** An ISO 8601 date-time with an explicit offset or Z, as FullCalendar sends it. */
function parseInstant(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
