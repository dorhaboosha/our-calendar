// Phase 1 Google spike: checks what the calendar.app.created scope allows, against a
// real Google account, before Phase 4 builds Calendar export on it.
//
//   node scripts/google-spike/spike.mjs               # the API checks
//   node scripts/google-spike/spike.mjs --visibility  # check by eye that the calendar shows up
//
// Prints a sign-in link, waits for the consent on http://localhost:3333/oauth2callback,
// runs the checks in a temporary calendar it creates, and deletes that calendar at the
// end. Uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env. Never prints tokens.
// Results: scripts/google-spike/output/results.json (git-ignored).

import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const API = "https://www.googleapis.com/calendar/v3";
const TIME_ZONE = "Asia/Jerusalem";
const OUTPUT_DIR = new URL("./output/", import.meta.url);

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret || clientSecret === "replace-me") {
  throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first");
}

const results = [];

/** Records one check. `pass` is whether the observed behavior matches what we expected. */
function record(check, expected, actual, pass) {
  results.push({ check, expected, actual, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${check}\n      expected: ${expected}\n      actual:   ${actual}`,
  );
}

// ---- OAuth (authorization code + PKCE, loopback redirect) ----

function base64url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function getAuthorizationCode() {
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        server.close();
        reject(new Error("No sign-in within 30 minutes"));
      },
      30 * 60 * 1000,
    );

    const server = createServer((request, response) => {
      const params = new URL(request.url, REDIRECT_URI).searchParams;
      if (!request.url.startsWith("/oauth2callback")) {
        response.writeHead(404).end();
        return;
      }
      const ok = params.get("state") === state && params.get("code");
      response.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        ok
          ? "<h1 dir='rtl'>ההרשאה התקבלה. אפשר לסגור את הלשונית ולחזור לטרמינל.</h1>"
          : `<h1>Sign-in failed: ${params.get("error") ?? "state mismatch"}</h1>`,
      );
      clearTimeout(timeout);
      server.close();
      if (ok) resolve(params.get("code"));
      else reject(new Error(`Sign-in failed: ${params.get("error") ?? "state mismatch"}`));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log("\nOpen this link in Chrome, sign in as Dor and approve:\n");
      console.log(url.toString());
      console.log("\nWaiting for the sign-in...\n");
    });
  });

  return { code, verifier };
}

async function tokenRequest(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(`Token request failed: ${body.error} ${body.error_description ?? ""}`);
  return body;
}

// ---- Calendar API ----

let accessToken;

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

function errorText(result) {
  const error = result.body?.error;
  return error ? `${result.status} ${error.message ?? ""}`.trim() : String(result.status);
}

/** Event ids may use a-v and 0-9; a UUID in hex qualifies. */
function newEventId() {
  return randomUUID().replaceAll("-", "");
}

/** "YYYY-MM-DD" a number of days from today, in Israel time. */
function dateInDays(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

// ---- The spike ----

async function signIn() {
  const { code, verifier } = await getAuthorizationCode();
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
  accessToken = tokens.access_token;
  return tokens;
}

/** Waits until http://localhost:3333/done is opened (up to 30 minutes). */
function waitForDone() {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => {
        server.close();
        resolve("timeout");
      },
      30 * 60 * 1000,
    );
    const server = createServer((request, response) => {
      if (!request.url.startsWith("/done")) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1 dir='rtl'>היומן הזמני יימחק עכשיו. אפשר לסגור את הלשונית.</h1>");
      clearTimeout(timeout);
      server.close();
      resolve("done");
    });
    server.listen(PORT, "127.0.0.1");
  });
}

/**
 * Creates a temporary calendar with two events and keeps it until the user has looked
 * for it in Google Calendar (web and phone), then deletes it.
 */
async function visibility() {
  await signIn();
  const created = await api("POST", "/calendars", {
    summary: "Our Calendar (בדיקה)",
    description: "Temporary calendar created by the Our Calendar spike. Deleted automatically.",
    timeZone: TIME_ZONE,
  });
  record("V1. Create a secondary calendar", "200", errorText(created), created.status === 200);
  if (created.status !== 200) return;
  const calendarId = encodeURIComponent(created.body.id);

  try {
    const timed = await api("POST", `/calendars/${calendarId}/events`, {
      id: newEventId(),
      summary: "דור: בדיקת סנכרון",
      colorId: "9",
      start: { dateTime: `${dateInDays(1)}T10:00:00`, timeZone: TIME_ZONE },
      end: { dateTime: `${dateInDays(1)}T11:00:00`, timeZone: TIME_ZONE },
    });
    record("V2. Timed event tomorrow 10:00-11:00", "200", errorText(timed), timed.status === 200);
    const allDay = await api("POST", `/calendars/${calendarId}/events`, {
      id: newEventId(),
      summary: "חופשה (בדיקה)",
      start: { date: dateInDays(2) },
      end: { date: dateInDays(4) },
    });
    record(
      "V3. All-day event, two days from the day after tomorrow",
      "200",
      errorText(allDay),
      allDay.status === 200,
    );

    console.log(`
Now look for the calendar "Our Calendar (בדיקה)":
  - Google Calendar on the web (calendar.google.com), under "My calendars"
  - Google Calendar on your phone (pull down to refresh; it can take a minute)
Events: "דור: בדיקת סנכרון" tomorrow 10:00-11:00, and "חופשה (בדיקה)" on ${dateInDays(2)}-${dateInDays(3)}.

When you are done, open http://localhost:${PORT}/done to delete the calendar.
Waiting (up to 30 minutes)...`);
    const outcome = await waitForDone();
    console.log(
      outcome === "done" ? "\nDeleting the calendar." : "\nTimed out; deleting the calendar.",
    );
  } finally {
    const removed = await api("DELETE", `/calendars/${calendarId}`);
    record(
      "V4. Delete the temporary calendar (cleanup)",
      "204",
      errorText(removed),
      removed.status === 204,
    );
  }
}

async function main() {
  const tokens = await signIn();

  const grantedScopes = (tokens.scope ?? "").split(" ").sort();
  record(
    "1. Granted scopes",
    `only ${SCOPE}`,
    grantedScopes.join(", "),
    grantedScopes.length === 1 && grantedScopes[0] === SCOPE,
  );
  record(
    "2. Refresh token issued",
    "a refresh token (offline access)",
    tokens.refresh_token ? "yes" : "no",
    Boolean(tokens.refresh_token),
  );
  const refreshLifetime = tokens.refresh_token_expires_in;
  record(
    "3. Refresh token lifetime (app in Testing mode)",
    "limited (Google: 7 days while the consent screen is in Testing)",
    refreshLifetime
      ? `${refreshLifetime} s (${(refreshLifetime / 86400).toFixed(1)} days)`
      : "no expiry returned",
    true,
  );

  // Access to calendars the app did not create.
  const list = await api("GET", "/users/me/calendarList?maxResults=250");
  const listed = list.status === 200 ? (list.body.items ?? []) : [];
  record(
    "4. calendarList (all of the user's calendars)",
    "forbidden, or only calendars this app created",
    list.status === 200
      ? `200, ${listed.length} calendar(s), primary included: ${listed.some((c) => c.primary)}`
      : errorText(list),
    list.status !== 200 || !listed.some((c) => c.primary),
  );
  const primaryRead = await api("GET", "/calendars/primary/events?maxResults=1");
  record(
    "5. Read events of the primary calendar",
    "blocked: 403, or 404 (Google hides calendars the app did not create)",
    errorText(primaryRead),
    primaryRead.status === 403 || primaryRead.status === 404,
  );
  const primaryWrite = await api("POST", "/calendars/primary/events", {
    summary: "Our Calendar spike - should not be created",
    start: { date: dateInDays(30) },
    end: { date: dateInDays(31) },
  });
  if (primaryWrite.status === 200) {
    await api("DELETE", `/calendars/primary/events/${primaryWrite.body.id}`);
  }
  record(
    "6. Create an event in the primary calendar",
    "blocked: 403, or 404 (Google hides calendars the app did not create)",
    errorText(primaryWrite),
    primaryWrite.status === 403 || primaryWrite.status === 404,
  );

  // A calendar of our own.
  const created = await api("POST", "/calendars", {
    summary: "Our Calendar (בדיקה)",
    description: "Temporary calendar created by the Our Calendar spike. Deleted automatically.",
    timeZone: TIME_ZONE,
  });
  record("7. Create a secondary calendar", "200", errorText(created), created.status === 200);
  if (created.status !== 200) return;
  const calendarId = encodeURIComponent(created.body.id);

  try {
    const listAfter = await api("GET", "/users/me/calendarList?maxResults=250");
    record(
      "8. Read the calendar list after creating our calendar",
      "403: this scope cannot read the calendar list (visibility is checked by eye with --visibility)",
      errorText(listAfter),
      listAfter.status === 403,
    );

    // Timed event with an id we choose (idempotent creates).
    const timedId = newEventId();
    const timed = {
      id: timedId,
      summary: "דור: רופא שיניים",
      description: "Spike event",
      colorId: "9",
      start: { dateTime: `${dateInDays(7)}T10:00:00`, timeZone: TIME_ZONE },
      end: { dateTime: `${dateInDays(7)}T11:00:00`, timeZone: TIME_ZONE },
      extendedProperties: { private: { ourCalendarEventId: "local-123", ourCalendarVersion: "1" } },
    };
    const insert = await api("POST", `/calendars/${calendarId}/events`, timed);
    record(
      "9. Create a timed event with our own id",
      "200, same id, colorId and private extended properties kept",
      insert.status === 200
        ? `200, id same: ${insert.body.id === timedId}, colorId: ${insert.body.colorId}, props: ${JSON.stringify(insert.body.extendedProperties?.private)}`
        : errorText(insert),
      insert.status === 200 &&
        insert.body.id === timedId &&
        insert.body.colorId === "9" &&
        insert.body.extendedProperties?.private?.ourCalendarEventId === "local-123",
    );
    const firstEtag = insert.body?.etag;

    const duplicate = await api("POST", `/calendars/${calendarId}/events`, timed);
    record(
      "10. Create again with the same id (a retry)",
      "409 duplicate, so a retry can never create a second copy",
      errorText(duplicate),
      duplicate.status === 409,
    );

    const patched = await api("PATCH", `/calendars/${calendarId}/events/${timedId}`, {
      summary: "דור: רופא שיניים (עודכן)",
    });
    record(
      "11. Update the event (PATCH)",
      "200 with a new etag; other fields untouched",
      patched.status === 200
        ? `200, etag changed: ${patched.body.etag !== firstEtag}, colorId still: ${patched.body.colorId}`
        : errorText(patched),
      patched.status === 200 && patched.body.etag !== firstEtag && patched.body.colorId === "9",
    );

    const staleUpdate = await fetch(`${API}/calendars/${calendarId}/events/${timedId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": firstEtag,
      },
      body: JSON.stringify({ summary: "should be rejected" }),
    });
    record(
      "12. Update with an old etag (If-Match)",
      "412 precondition failed (detects edits made in Google)",
      String(staleUpdate.status),
      staleUpdate.status === 412,
    );

    // All-day event over two days: Google's end date is exclusive.
    const allDayId = newEventId();
    const allDay = await api("POST", `/calendars/${calendarId}/events`, {
      id: allDayId,
      summary: "חופשה",
      start: { date: dateInDays(10) },
      end: { date: dateInDays(12) },
    });
    record(
      "13. All-day event over two days (end date exclusive)",
      `200, start.date ${dateInDays(10)}, end.date ${dateInDays(12)}, no times`,
      allDay.status === 200
        ? `200, start ${JSON.stringify(allDay.body.start)}, end ${JSON.stringify(allDay.body.end)}`
        : errorText(allDay),
      allDay.status === 200 &&
        allDay.body.start.date === dateInDays(10) &&
        allDay.body.end.date === dateInDays(12) &&
        !allDay.body.start.dateTime,
    );

    // Recurring event, its instances and a one-instance exception.
    const seriesId = newEventId();
    const series = await api("POST", `/calendars/${calendarId}/events`, {
      id: seriesId,
      summary: "ארוחת ערב",
      start: { dateTime: `${dateInDays(8)}T19:00:00`, timeZone: TIME_ZONE },
      end: { dateTime: `${dateInDays(8)}T21:00:00`, timeZone: TIME_ZONE },
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"],
    });
    record(
      "14. Create a weekly recurring event (RRULE, 3 times)",
      "200",
      errorText(series),
      series.status === 200,
    );

    const instances = await api("GET", `/calendars/${calendarId}/events/${seriesId}/instances`);
    const instanceIds = instances.status === 200 ? instances.body.items.map((item) => item.id) : [];
    record(
      "15. Instance ids of the series",
      "3 instances, ids derived from the series id",
      instances.status === 200
        ? `${instanceIds.length}: ${instanceIds.join(", ")}`
        : errorText(instances),
      instanceIds.length === 3 && instanceIds.every((id) => id.startsWith(`${seriesId}_`)),
    );

    if (instanceIds[1]) {
      const exception = await api("PATCH", `/calendars/${calendarId}/events/${instanceIds[1]}`, {
        summary: "ארוחת ערב (הוזז)",
        start: { dateTime: `${dateInDays(15)}T20:00:00`, timeZone: TIME_ZONE },
        end: { dateTime: `${dateInDays(15)}T22:00:00`, timeZone: TIME_ZONE },
      });
      record(
        "16. Change one instance (an exception)",
        "200, same instance id, recurringEventId is the series id",
        exception.status === 200
          ? `200, id same: ${exception.body.id === instanceIds[1]}, recurringEventId: ${exception.body.recurringEventId}`
          : errorText(exception),
        exception.status === 200 && exception.body.recurringEventId === seriesId,
      );
    }
    if (instanceIds[2]) {
      const cancelInstance = await api(
        "DELETE",
        `/calendars/${calendarId}/events/${instanceIds[2]}`,
      );
      const afterCancel = await api("GET", `/calendars/${calendarId}/events/${seriesId}/instances`);
      record(
        "17. Cancel one instance",
        "204, the series then has 2 instances",
        `${cancelInstance.status}, instances now: ${afterCancel.body?.items?.length}`,
        cancelInstance.status === 204 && afterCancel.body?.items?.length === 2,
      );
    }

    // Delete, then bring back the same id (undo, or retrying after a delete).
    const deleted = await api("DELETE", `/calendars/${calendarId}/events/${timedId}`);
    const afterDelete = await api("GET", `/calendars/${calendarId}/events/${timedId}`);
    record(
      "18. Delete the event, then read it",
      "204, then the event still exists with status cancelled",
      `${deleted.status}, then ${afterDelete.status} status=${afterDelete.body?.status}`,
      deleted.status === 204,
    );

    const reinsert = await api("POST", `/calendars/${calendarId}/events`, {
      ...timed,
      summary: "דור: רופא שיניים (שוחזר)",
    });
    record(
      "19. Create again with the deleted event's id",
      "unknown - this is what we want to learn",
      errorText(reinsert),
      true,
    );
    if (reinsert.status !== 200) {
      const restore = await api("PATCH", `/calendars/${calendarId}/events/${timedId}`, {
        status: "confirmed",
        summary: "דור: רופא שיניים (שוחזר)",
      });
      record(
        "20. Restore the deleted event by updating status to confirmed",
        "200, status confirmed",
        restore.status === 200 ? `200, status=${restore.body.status}` : errorText(restore),
        restore.status === 200 && restore.body.status === "confirmed",
      );
    }

    // A new access token from the refresh token (what the export worker will do).
    if (tokens.refresh_token) {
      const refreshed = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      });
      accessToken = refreshed.access_token;
      const check = await api("GET", `/calendars/${calendarId}`);
      record(
        "21. New access token from the refresh token",
        "works for the app's calendar",
        errorText(check),
        check.status === 200,
      );
    }
  } finally {
    const removed = await api("DELETE", `/calendars/${calendarId}`);
    record(
      "22. Delete the temporary calendar (cleanup)",
      "204",
      errorText(removed),
      removed.status === 204,
    );
  }
}

try {
  await (process.argv.includes("--visibility") ? visibility() : main());
} catch (error) {
  console.error(`\nSpike stopped: ${error.message}`);
  results.push({ check: "Spike stopped early", actual: error.message, pass: false });
} finally {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    new URL(process.argv.includes("--visibility") ? "visibility.json" : "results.json", OUTPUT_DIR),
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
  );
  const failed = results.filter((result) => !result.pass).length;
  console.log(`\nDone: ${results.length - failed} as expected, ${failed} not as expected.`);
  console.log("Results saved in scripts/google-spike/output/");
}
