import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, insertEvent, test } from "./fixtures";

// Automated accessibility checks (axe-core, WCAG 2.1 A and AA) on every screen and
// dialog. They catch contrast, names, labels and ARIA mistakes; keyboard use and
// screen-reader wording are covered by the other tests.
const NOW = new Date("2026-11-05T09:00:00+02:00");

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("the public pages", async ({ page }) => {
  for (const path of ["/login", "/login?error=not_allowed", "/privacy"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await violations(page), path).toEqual([]);
  }
});

test.describe("signed in", () => {
  test.beforeEach(async ({ signInAs }) => {
    await signInAs("maayan");
    await signInAs("dor");
    await insertEvent({
      title: "רופא שיניים",
      owner: "dor",
      category: "personal",
      start: "2026-11-05T10:00:00+02:00",
      end: "2026-11-05T11:00:00+02:00",
      location: "רחוב הרצל 1",
    });
    await insertEvent({
      title: "חופשה",
      owner: "maayan",
      category: "vacation",
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
  });

  test("the calendar in each view, with filters on", async ({ page }) => {
    for (const view of ["month", "week", "day"]) {
      await page.goto(`/?view=${view}`);
      await expect(page.getByTestId("calendar").getByText("רופא שיניים")).toBeVisible();
      expect(await violations(page), view).toEqual([]);
    }
    await page.goto("/?view=month&hideOwners=maayan&hideCategories=work");
    await expect(page.getByTestId("calendar").getByText("רופא שיניים")).toBeVisible();
    expect(await violations(page), "filtered").toEqual([]);
  });

  test("the event dialogs", async ({ page }) => {
    await page.goto("/?view=month");
    await page
      .getByTestId("calendar")
      .getByRole("button", { name: /רופא שיניים/ })
      .click();
    const details = page.getByRole("dialog", { name: "רופא שיניים" });
    await expect(details).toBeVisible();
    expect(await violations(page), "details").toEqual([]);

    await details.getByRole("button", { name: "מחיקה" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await violations(page), "delete").toEqual([]);
    await page.getByRole("alertdialog").getByRole("button", { name: "ביטול" }).click();

    await details.getByRole("button", { name: "עריכה" }).click();
    const form = page.getByRole("dialog", { name: "עריכת אירוע" });
    await expect(form).toBeVisible();
    await form.getByLabel("כותרת", { exact: true }).fill("");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByText("יש לכתוב כותרת.")).toBeVisible();
    expect(await violations(page), "form with errors").toEqual([]);
  });

  test("settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    expect(await violations(page)).toEqual([]);
  });
});
