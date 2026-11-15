import type { Page } from "@playwright/test";
import { expect, insertEvent, test } from "./fixtures";

// Repeating events in the calendar and their dialogs. The clock is Thursday 5 November
// 2026, 09:20 in Israel; Dor is signed in. The series: pilates every Thursday at 18:00
// from 5 November.
const NOW = new Date("2026-11-05T09:20:00+02:00");

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
});

const calendar = (page: Page) => page.getByTestId("calendar");
const details = (page: Page) => page.getByRole("dialog", { name: "פילאטיס" });

/** Opens the details of the occurrence on the given day of November. */
async function openOccurrence(page: Page, day: number) {
  await page.goto("/?view=month");
  const cell = calendar(page).locator(
    `[role="cell"][data-date="2026-11-${String(day).padStart(2, "0")}"]`,
  );
  await cell.getByRole("button", { name: /פילאטיס/ }).click();
  await expect(details(page)).toBeVisible();
}

test("shows each occurrence, and how the series repeats", async ({ page }) => {
  await page.goto("/?view=month");
  // The month view's six weeks: 5, 12, 19 and 26 November, 3 and 10 December.
  await expect(calendar(page).getByText("פילאטיס", { exact: true })).toHaveCount(6);
  await openOccurrence(page, 19);
  await expect(details(page).getByText("יום חמישי, 19 בנובמבר 2026")).toBeVisible();
  await expect(details(page).getByText("חוזר כל שבוע ביום חמישי")).toBeVisible();
});

test("editing an occurrence asks which occurrences first", async ({ page }) => {
  await openOccurrence(page, 19);
  await details(page).getByRole("button", { name: "עריכה" }).click();
  const scope = page.getByRole("dialog", { name: "עריכת אירוע חוזר" });
  await expect(scope.getByRole("radio", { name: "המופע הזה", exact: true })).toBeChecked();

  // "Cancel" goes back to the details.
  await scope.getByRole("button", { name: "ביטול" }).click();
  await expect(details(page)).toBeVisible();

  // This occurrence: its own date, no repeat choices, and the series' owner.
  await details(page).getByRole("button", { name: "עריכה" }).click();
  await scope.getByRole("button", { name: "המשך" }).click();
  const form = page.getByRole("dialog", { name: "עריכת המופע" });
  await expect(form.getByLabel("תאריך התחלה", { exact: true })).toHaveValue("2026-11-19");
  await expect(form.getByLabel("חזרה", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("שייך ל", { exact: true })).toBeDisabled();
});

test("editing all occurrences starts from the series' first one", async ({ page }) => {
  await openOccurrence(page, 19);
  await details(page).getByRole("button", { name: "עריכה" }).click();
  const scope = page.getByRole("dialog", { name: "עריכת אירוע חוזר" });
  await scope.getByText("כל המופעים", { exact: true }).click();
  await scope.getByRole("button", { name: "המשך" }).click();
  const form = page.getByRole("dialog", { name: "עריכת כל המופעים" });
  await expect(form.getByLabel("תאריך התחלה", { exact: true })).toHaveValue("2026-11-05");
  await expect(form.getByLabel("חזרה", { exact: true })).toHaveValue("weekly");
  await expect(form.getByLabel("חמישי", { exact: true })).toBeChecked();
  await expect(form.getByLabel("שייך ל", { exact: true })).toBeEnabled();
});

test("deleting an occurrence asks which occurrences", async ({ page }) => {
  await openOccurrence(page, 12);
  await details(page).getByRole("button", { name: "מחיקה" }).click();
  const confirm = page.getByRole("alertdialog", { name: "למחוק אירוע חוזר?" });
  await expect(confirm.getByRole("radio")).toHaveCount(3);
  await expect(confirm.getByRole("radio", { name: "המופע הזה", exact: true })).toBeChecked();
  // Focus starts on "cancel", as for any deletion.
  await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused();
});
