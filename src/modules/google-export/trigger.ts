// When the export jobs run. There is no worker process (Render's free plan sleeps), so
// jobs run in the web server itself:
// - right after a change, once the response is sent (exportSoon, with Next's after());
// - when someone opens a page, for retries that came due (exportWhenDue);
// - every 30 minutes from GitHub Actions, through POST /api/jobs/run, so retries happen
//   even when nobody uses the app.
// Two runs at once can't take the same job (the outbox locks them); within one server,
// runs are also kept from overlapping, so a burst of changes is one run.

import "server-only";
import { after } from "next/server";
import { type ApiFor, runExportJobs } from "./export-jobs";
import { googleApiFor } from "./google-client";

/** A run stops taking new jobs after this long; the rest wait for the next run. */
export const RUN_BUDGET_MS = 2 * 60 * 1000;
/** Page views look for due jobs at most this often (each look is a database query). */
export const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

let running: Promise<number> | null = null;
let again = false;
let lastIdleCheck = 0;

/**
 * Runs the due export jobs until none are left (or the budget runs out). If a run is
 * already going in this server, it runs once more when that one ends, and this waits
 * for both. Never throws: a failure is logged, and the jobs stay queued. Returns how
 * many jobs ran.
 */
export function runExportsNow({
  apiFor = googleApiFor,
  budgetMs = RUN_BUDGET_MS,
}: { apiFor?: ApiFor; budgetMs?: number } = {}): Promise<number> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    try {
      do {
        again = false;
        const started = Date.now();
        let ran: number;
        do {
          ran = await runExportJobs(apiFor);
          total += ran;
        } while (ran > 0 && Date.now() - started < budgetMs);
      } while (again);
    } catch (error) {
      // Never a token: export errors are only statuses and reasons.
      console.error("Export run failed:", error instanceof Error ? error.message : error);
    } finally {
      running = null;
      lastIdleCheck = Date.now();
    }
    return total;
  })();
  return running;
}

/**
 * Runs the export after the response is sent, for a change just saved. Outside a request
 * (tests, scripts) there is nothing to run after, and nothing is scheduled.
 */
export function exportSoon() {
  try {
    after(() => runExportsNow());
  } catch {
    // Not in a request.
  }
}

/** On a page view: runs due jobs (retries) after the response, at most once a minute. */
export function exportWhenDue(now = Date.now()) {
  if (running || now - lastIdleCheck < IDLE_CHECK_INTERVAL_MS) return;
  lastIdleCheck = now;
  exportSoon();
}
