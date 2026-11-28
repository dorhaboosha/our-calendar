import type { Page } from "@playwright/test";
import { db, expect, insertEvent, test } from "./fixtures";

// Loading the events again on return, retrying a failed load (spec 4.5), and the notice
// shown without a connection (spec 8.1). The clock is fixed to Thursday 5 November 2026
// (timers still run), so the calendar opens on the same week.
const NOW = new Date("2026-11-05T09:00:00+02:00");
const NOTICE = "אין חיבור כרגע";

const notice = (page: Page) => page.getByRole("alert").filter({ hasText: NOTICE });
const event = (page: Page, title: string) =>
  page.getByTestId("calendar").getByText(title, { exact: true });

/** Requests made while offline fail in the console; in these tests that is expected. */
function dropOfflineErrors(pageErrors: string[]) {
  pageErrors.splice(
    0,
    pageErrors.length,
    ...pageErrors.filter((error) => !error.includes("ERR_INTERNET_DISCONNECTED")),
  );
}

/** Counts the event loads the page makes from now on. */
function countLoads(page: Page) {
  const loads = { count: 0 };
  page.on("request", (request) => {
    if (request.url().includes("/api/events?")) loads.count++;
  });
  return loads;
}

async function insertLater(title: string) {
  await insertEvent({
    title,
    owner: "maayan",
    category: "couple",
    start: "2026-11-05T18:00:00+02:00",
    end: "2026-11-05T19:00:00+02:00",
  });
}

test.beforeEach(async ({ page, signInAs }) => {
  await page.clock.setFixedTime(NOW);
  await signInAs("maayan");
  await signInAs("dor");
  await insertEvent({
    title: "רופא שיניים",
    owner: "dor",
    category: "personal",
    start: "2026-11-05T10:00:00+02:00",
    end: "2026-11-05T11:00:00+02:00",
  });
});

test("returning to the page loads the events again, keeping an open form and its text", async ({
  page,
}) => {
  await page.goto("/?view=week");
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await page.getByRole("button", { name: "אירוע חדש" }).click();
  const title = page.getByRole("dialog").getByLabel("כותרת", { exact: true });
  await title.fill("עדיין כאן");

  // Maayan adds an event meanwhile; the app comes back from the background.
  await insertLater("סרט");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(event(page, "סרט")).toBeAttached();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(title).toHaveValue("עדיין כאן");
  await expect(page).toHaveURL(/view=week/);
});

test("a return and a reconnection together load once", async ({ page }) => {
  await page.goto("/?view=week");
  await expect(event(page, "רופא שיניים")).toBeVisible();
  const loads = countLoads(page);
  const loaded = page.waitForResponse((response) => response.url().includes("/api/events?"));
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await loaded;
  // Give a second load, if any, time to start.
  await page.waitForTimeout(500);
  expect(loads.count).toBe(1);
});

test("a failed load shows the notice, and is tried again until it works", async ({
  page,
  pageErrors,
}) => {
  let failing = true;
  let failed = 0;
  await page.route("**/api/events?**", async (route) => {
    if (!failing) return route.continue();
    failed++;
    await route.fulfill({ status: 500, body: "{}" });
  });
  await page.goto("/?view=week");
  await expect(notice(page)).toBeVisible();
  // Tried again on its own, after a delay.
  await expect.poll(() => failed, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  failing = false;
  await expect(event(page, "רופא שיניים")).toBeVisible({ timeout: 15_000 });
  await expect(notice(page)).toHaveCount(0);
  // The browser logs the simulated 500s; those errors are the point of this test.
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((error) => !error.includes("500")));
});

test("offline shows the notice, and back online loads the events again @mobile", async ({
  page,
  context,
  pageErrors,
}) => {
  await page.goto("/?view=day");
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  await context.setOffline(true);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText("כדי לראות אירועים עדכניים ולשמור שינויים");
  // The notice fits a phone screen.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  await insertLater("סרט");
  await context.setOffline(false);
  await expect(event(page, "סרט")).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  dropOfflineErrors(pageErrors);
});

test("saving without a connection fails and keeps the form, and nothing is sent later", async ({
  page,
  context,
  pageErrors,
}) => {
  await page.goto("/?view=week");
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await page.getByRole("button", { name: "אירוע חדש" }).click();
  const form = page.getByRole("dialog", { name: "אירוע חדש" });
  await form.getByLabel("כותרת", { exact: true }).fill("ארוחת ערב");

  await context.setOffline(true);
  await form.getByRole("button", { name: "שמירה" }).click();
  await expect(form).toContainText("השמירה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.");
  await expect(form.getByLabel("כותרת", { exact: true })).toHaveValue("ארוחת ערב");

  // Back online, the failed save is not sent on its own.
  await context.setOffline(false);
  await expect(notice(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  const titles = async () =>
    (await db.query(`SELECT title FROM "event" ORDER BY title`)).rows.map((row) => row.title);
  expect(await titles()).toEqual(["רופא שיניים"]);

  // Saving again, online, works.
  await form.getByRole("button", { name: "שמירה" }).click();
  await expect(form).toBeHidden();
  await expect(event(page, "ארוחת ערב")).toBeVisible();
  expect(await titles()).toEqual(["ארוחת ערב", "רופא שיניים"]);
  dropOfflineErrors(pageErrors);
});

test("the notice shows on other pages too, without a connection", async ({
  page,
  context,
  pageErrors,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "הגדרות" }).first()).toBeVisible();
  await context.setOffline(true);
  await expect(notice(page)).toBeVisible();
  await context.setOffline(false);
  await expect(notice(page)).toHaveCount(0);
  dropOfflineErrors(pageErrors);
});
