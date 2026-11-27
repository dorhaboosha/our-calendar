import type { Page } from "@playwright/test";
import { connectExportInDatabase, expect, insertEvent, test } from "./fixtures";

// On a phone every control is at least 44×44 px (spec 13): buttons, links outside
// running text, fields, tabs, and checkbox and radio rows (their label counts). Not
// FullCalendar's events, whose size follows their duration and the grid. The clock is
// Thursday 5 November 2026, 09:20 in Israel.
const NOW = new Date("2026-11-05T09:20:00+02:00");
const MIN = 44;

test.skip(() => test.info().project.name !== "mobile", "phone only");

/** The controls smaller than 44×44 px on the page, or in the dialog open on it. */
async function smallTargets(page: Page) {
  // Let dialogs finish opening first: they grow in.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate((min) => {
    const controls =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="radio"]';
    const scope = document.querySelector('[role="dialog"], [role="alertdialog"]') ?? document.body;
    const seen = new Set<Element>();
    const small: string[] = [];
    for (const control of scope.querySelectorAll(controls)) {
      // A checkbox or radio is tapped through its whole label.
      const target = control.closest("label") ?? control;
      if (seen.has(target)) continue;
      seen.add(target);
      // FullCalendar's events, and links inside running text (WCAG's inline exception).
      const isEvent = target.matches('[data-testid="calendar"] div[role="button"]');
      if (isEvent || target.closest("p")) continue;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (Math.round(box.width) < min || Math.round(box.height) < min) {
        const name = control.getAttribute("aria-label") ?? target.textContent ?? "";
        small.push(
          `${target.tagName.toLowerCase()} "${name.trim().slice(0, 30)}" ${Math.round(box.width)}×${Math.round(box.height)}`,
        );
      }
    }
    return small;
  }, MIN);
}

test.beforeEach(async ({ page, signInAs }) => {
  await page.clock.setFixedTime(NOW);
  await signInAs("maayan");
  await signInAs("dor");
  await insertEvent({
    title: "פילאטיס",
    owner: "maayan",
    category: "personal",
    start: "2026-11-05T18:00:00+02:00",
    end: "2026-11-05T19:00:00+02:00",
    rrule: "FREQ=WEEKLY;BYDAY=TH;WKST=SU",
  });
  // More events on one day than its cell in the month view shows: a "+N" link.
  for (const hour of [10, 11, 12, 13, 14]) {
    await insertEvent({
      title: `פגישה ${hour}`,
      owner: "dor",
      category: "meeting",
      start: `2026-11-10T${hour}:00:00+02:00`,
      end: `2026-11-10T${hour}:30:00+02:00`,
    });
  }
});

test("the calendar, the event form and the event dialogs @mobile", async ({ page }) => {
  const calendar = page.getByTestId("calendar");
  const pilates = calendar.getByRole("button", { name: /פילאטיס/ });

  await page.goto("/");
  await expect(pilates).toBeVisible();
  expect(await smallTargets(page), "day view").toEqual([]);
  await page.getByRole("button", { name: "סינון לפי קטגוריה" }).click();
  expect(await smallTargets(page), "category filters").toEqual([]);
  await calendar.getByRole("tab", { name: "חודש" }).click();
  expect(await smallTargets(page), "month view").toEqual([]);
  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/mobile-month-targets.png` });
  }
  await calendar.getByRole("tab", { name: "יום" }).click();

  await page.getByRole("button", { name: "אירוע חדש" }).click();
  const form = page.getByRole("dialog", { name: "אירוע חדש" });
  await form.getByLabel("חזרה", { exact: true }).selectOption("weekly");
  await form.getByLabel("סיום החזרה", { exact: true }).selectOption("count");
  expect(await smallTargets(page), "the form, with the repeat fields").toEqual([]);
  await form.getByRole("button", { name: "ביטול" }).click();
  await expect(form).toBeHidden();

  await pilates.click();
  const details = page.getByRole("dialog", { name: "פילאטיס" });
  await expect(details).toBeVisible();
  expect(await smallTargets(page), "details").toEqual([]);
  await details.getByRole("button", { name: "עריכה" }).click();
  const scope = page.getByRole("dialog", { name: "עריכת אירוע חוזר" });
  await expect(scope).toBeVisible();
  expect(await smallTargets(page), "which occurrences").toEqual([]);
  await scope.getByRole("button", { name: "ביטול" }).click();
  await page
    .getByRole("dialog", { name: "פילאטיס" })
    .getByRole("button", { name: "מחיקה" })
    .click();
  await expect(page.getByRole("alertdialog", { name: "למחוק אירוע חוזר?" })).toBeVisible();
  expect(await smallTargets(page), "delete").toEqual([]);
});

test("settings, with the Google export connected and disconnecting @mobile", async ({
  page,
  signInAs,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "חבר ייצוא ל-Google Calendar" })).toBeVisible();
  expect(await smallTargets(page), "not connected").toEqual([]);

  const dor = await signInAs("dor");
  await connectExportInDatabase(dor.id);
  await page.reload();
  const disconnect = page.getByRole("button", { name: "ניתוק הייצוא" });
  await disconnect.click();
  await expect(page.getByRole("group", { name: "ניתוק הייצוא ל-Google Calendar" })).toBeVisible();
  expect(await smallTargets(page), "connected, disconnecting").toEqual([]);
});

test("the public pages @mobile", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "התחברות עם Google" })).toBeVisible();
  expect(await smallTargets(page), "login").toEqual([]);
  await page.goto("/privacy");
  expect(await smallTargets(page), "privacy").toEqual([]);
});
