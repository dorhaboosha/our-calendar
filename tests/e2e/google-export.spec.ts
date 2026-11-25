import type { Page } from "@playwright/test";
import { connectExportInDatabase, db, expect, test } from "./fixtures";

// The Google export section of the settings page, and the header's pointer to it. No
// call reaches Google: connecting is only a link, and the stored token is a dummy.

const section = (page: Page) => page.getByRole("region", { name: "ייצוא ל-Google Calendar" });

const statusOf = async (userId: string) =>
  (await db.query('SELECT status FROM "google_connection" WHERE "userId" = $1', [userId])).rows[0]
    ?.status;

test("not connected: the explanation and a link to connect", async ({ page, signInAs }) => {
  await signInAs("dor");
  await page.goto("/settings");
  const export_ = section(page);
  await expect(export_.getByText("הייצוא לא מחובר.")).toBeVisible();
  await expect(export_.getByText(/רק ליומנים שהוא עצמו יוצר/)).toBeVisible();
  await expect(export_.getByRole("link", { name: "חבר ייצוא ל-Google Calendar" })).toHaveAttribute(
    "href",
    "/api/integrations/google/connect",
  );
  await expect(export_.getByRole("button", { name: "ניתוק הייצוא" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /נדרשת פעולה/ })).toHaveCount(0);
});

test("coming back from Google shows the result once", async ({ page, signInAs }) => {
  await signInAs("dor");
  await page.goto("/settings?google=denied#google-export");
  await expect(section(page).getByRole("alert")).toHaveText(
    "החיבור בוטל, ולא ניתנה גישה ל-Google.",
  );
  await expect(page).toHaveURL(/\/settings#google-export$/);
  await page.reload();
  await expect(section(page).getByText("הייצוא לא מחובר.")).toBeVisible();
  await expect(section(page).getByRole("alert")).toHaveCount(0);
});

/** The job left after a run, and what it says (the dummy token makes every run fail). */
const failedJobs = async () =>
  (await db.query('SELECT type, status, "lastError" FROM "export_job"')).rows;

test("export again runs a full export right after the response", async ({ page, signInAs }) => {
  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id);
  await page.goto("/settings");
  await section(page).getByRole("button", { name: "ייצא מחדש ל-Google" }).click();
  await expect(section(page).getByRole("status")).toHaveText(/הייצוא המלא התחיל/);
  await expect(section(page).getByText("מחובר. ממתין לייצוא.")).toBeVisible();

  // The job ran after the response: the dummy token can't be read, which counts as
  // access that has to be granted again.
  await expect.poll(() => statusOf(dor.id)).toBe("NEEDS_REAUTH");
  // The job is marked failed only after the connection, so it is polled too.
  await expect.poll(failedJobs).toEqual([
    {
      type: "CREATE_CALENDAR",
      status: "FAILED",
      lastError: "google:401 token_unreadable (reauth)",
    },
  ]);
  await page.reload();
  await expect(page.getByRole("link", { name: "ייצוא ל-Google: נדרשת פעולה" })).toBeVisible();
});

test("disconnecting: choose what happens to the calendar, or cancel", async ({
  page,
  signInAs,
}) => {
  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id);
  await page.goto("/settings");
  const export_ = section(page);
  const disconnect = export_.getByRole("button", { name: "ניתוק הייצוא" });

  await disconnect.click();
  const panel = export_.getByRole("group", { name: "ניתוק הייצוא ל-Google Calendar" });
  await expect(panel).toBeFocused();
  await expect(panel.getByRole("radio", { name: /להשאיר אותו/ })).toBeChecked();
  await panel.getByRole("button", { name: "ביטול" }).click();
  await expect(disconnect).toBeFocused();

  // Deleting the calendar needs Google; with the dummy token it fails, and nothing changes.
  await disconnect.click();
  await panel.getByText("למחוק אותו מ-Google").click();
  await panel.getByRole("button", { name: "נתק" }).click();
  await expect(export_.getByRole("alert")).toHaveText(/מחיקת היומן ב-Google נכשלה/);
  expect(await statusOf(dor.id)).toBe("ACTIVE");

  await panel.getByText("להשאיר אותו").click();
  await panel.getByRole("button", { name: "נתק" }).click();
  await expect(export_.getByRole("status")).toHaveText(/הייצוא נותק/);
  await expect(export_.getByText("הייצוא לא מחובר.")).toBeVisible();
  await expect(export_.getByRole("link", { name: "חבר ייצוא ל-Google Calendar" })).toBeVisible();
  expect(await statusOf(dor.id)).toBe("DISCONNECTED");
});

test("a deleted calendar: the header points to settings, where it is created again", async ({
  page,
  signInAs,
}) => {
  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id, { target: "NEEDS_ACTION" });
  await page.goto("/");
  await page.getByRole("link", { name: "ייצוא ל-Google: נדרשת פעולה" }).click();
  await expect(page).toHaveURL(/\/settings#google-export$/);
  const export_ = section(page);
  await expect(export_.getByText(/נדרשת פעולה: היומן "Our Calendar" נמחק/)).toBeVisible();

  await export_.getByRole("button", { name: "צור את היומן מחדש" }).click();
  await expect(export_.getByText("מחובר. ממתין לייצוא.")).toBeVisible();
  await expect(page.getByRole("link", { name: /נדרשת פעולה/ })).toHaveCount(0);
  // Then the job runs, and fails on the dummy token (see the test above).
  await expect.poll(() => statusOf(dor.id)).toBe("NEEDS_REAUTH");
});

test("access to Google revoked: connect again, and the calendar can't be deleted", async ({
  page,
  signInAs,
}) => {
  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id, { connection: "NEEDS_REAUTH" });
  await page.goto("/settings");
  const export_ = section(page);
  await expect(export_.getByRole("link", { name: "התחברות מחדש ל-Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ייצוא ל-Google: נדרשת פעולה" })).toBeVisible();
  await export_.getByRole("button", { name: "ניתוק הייצוא" }).click();
  await expect(export_.getByRole("radio")).toHaveCount(0);
  await expect(export_.getByText(/יישאר ב-Google, אם כבר נוצר/)).toBeVisible();
});

const SHOTS = process.env.E2E_SCREENSHOTS;

/** How far the page is wider than the screen; 0 or less means no sideways scrolling. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("on a phone: the header's link and the export section fit the screen @mobile", async ({
  page,
  signInAs,
}) => {
  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id, { target: "NEEDS_ACTION" });
  await page.goto("/");
  const needsAction = page.getByRole("link", { name: "ייצוא ל-Google: נדרשת פעולה" });
  await expect(needsAction).toBeInViewport();
  await expect(page.getByTestId("calendar")).toBeVisible();
  expect(await overflow(page), "the calendar page").toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mobile-export-header.png` });

  await needsAction.click();
  const export_ = section(page);
  await expect(export_.getByRole("button", { name: "צור את היומן מחדש" })).toBeVisible();
  await export_.getByRole("button", { name: "ניתוק הייצוא" }).click();
  const panel = export_.getByRole("group", { name: "ניתוק הייצוא ל-Google Calendar" });
  await expect(panel.getByRole("button", { name: "נתק" })).toBeInViewport();
  expect(await overflow(page), "disconnecting in settings").toBeLessThanOrEqual(0);
  // Every control of the section stays inside the screen.
  const width = page.viewportSize()!.width;
  for (const control of await export_.locator("button, a, input").all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  if (SHOTS) {
    await export_.screenshot({ path: `${SHOTS}/mobile-export-disconnect.png` });
  }
});
