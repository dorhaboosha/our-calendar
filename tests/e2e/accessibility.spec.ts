import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { connectExportInDatabase, db, expect, insertEvent, test } from "./fixtures";

// Automated accessibility checks (axe-core, WCAG 2.1 A and AA) on every screen and
// dialog. They catch contrast, names, labels and ARIA mistakes; keyboard use and
// screen-reader wording are covered by the other tests.
const NOW = new Date("2026-11-05T09:00:00+02:00");

async function violations(page: Page) {
  // Let dialogs finish fading in and out first: half-transparent text fails contrast.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 5).map((node) => ({
      target: node.target.join(" "),
      html: node.html,
      failure: node.failureSummary,
    })),
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

    // Every repeat field showing, with errors: the days and the number of times.
    await form.getByLabel("כותרת", { exact: true }).fill("רופא שיניים");
    await form.getByLabel("חזרה", { exact: true }).selectOption("weekly");
    await form.getByText("חמישי", { exact: true }).click();
    await form.getByText("שישי", { exact: true }).click();
    await form.getByLabel("סיום החזרה", { exact: true }).selectOption("count");
    await form.getByLabel("מספר פעמים", { exact: true }).fill("0");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(form.getByText("יש לכתוב מספר פעמים בין 1 ל-999.")).toBeVisible();
    await expect(form.getByText("היום של תאריך ההתחלה צריך להיות אחד הימים שנבחרו.")).toBeVisible();
    expect(await violations(page), "repeat fields with errors").toEqual([]);
  });

  test("the dialogs of a repeating event", async ({ page }) => {
    await insertEvent({
      title: "פילאטיס",
      owner: "maayan",
      start: "2026-11-05T18:00:00+02:00",
      end: "2026-11-05T19:00:00+02:00",
      rrule: "FREQ=WEEKLY;BYDAY=TH;WKST=SU",
    });
    await page.goto("/?view=month");
    await page
      .getByTestId("calendar")
      .getByRole("button", { name: /פילאטיס/ })
      .first()
      .click();
    const details = page.getByRole("dialog", { name: "פילאטיס" });
    await expect(details.getByText("חוזר כל שבוע ביום חמישי")).toBeVisible();
    expect(await violations(page), "details").toEqual([]);

    await details.getByRole("button", { name: "מחיקה" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await violations(page), "delete").toEqual([]);
    await page.getByRole("alertdialog").getByRole("button", { name: "ביטול" }).click();

    await details.getByRole("button", { name: "עריכה" }).click();
    const scope = page.getByRole("dialog", { name: "עריכת אירוע חוזר" });
    await expect(scope).toBeVisible();
    expect(await violations(page), "edit scope").toEqual([]);

    await scope.getByRole("button", { name: "המשך" }).click();
    await expect(page.getByRole("dialog", { name: "עריכת המופע" })).toBeVisible();
    expect(await violations(page), "form for one occurrence").toEqual([]);
  });

  test("settings", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    expect(await violations(page)).toEqual([]);
  });

  test.describe("the Google export", () => {
    const exportSection = (page: Page) =>
      page.getByRole("region", { name: "ייצוא ל-Google Calendar" });
    const needsAction = (page: Page) =>
      page.getByRole("link", { name: "ייצוא ל-Google: נדרשת פעולה" });
    const open = async (page: Page, path = "/settings") => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    };
    /** Dor's export, in the state given. */
    const exportAs = async (options: Parameters<typeof connectExportInDatabase>[1]) => {
      const { rows } = await db.query(`SELECT id FROM "user" WHERE "configKey" = 'dor'`);
      return connectExportInDatabase(rows[0].id, options);
    };
    const addJob = (targetId: string, status: string, nextAttemptAt: string) =>
      db.query(
        `INSERT INTO "export_job" (id, type, "exportTargetId", status, "attemptCount",
           "nextAttemptAt", "updatedAt")
         VALUES ($1, 'FULL_RECONCILE', $2, $3, 0, $4, now())`,
        [randomUUID(), targetId, status, nextAttemptAt],
      );

    test("up to date, with a failed export, and disconnecting", async ({ page }) => {
      const targetId = await exportAs({ lastExportAt: "2026-11-05T08:30:00+02:00" });
      await addJob(targetId, "FAILED", "2026-11-05T08:30:00+02:00");
      await open(page);
      const section = exportSection(page);
      await expect(section.getByText("מחובר. היומן ב-Google מעודכן.")).toBeVisible();
      await expect(section.getByText("אירוע אחד לא יוצא בגלל שגיאה.")).toBeVisible();
      expect(await violations(page), "up to date, one failed").toEqual([]);

      await section.getByRole("button", { name: "ניתוק הייצוא" }).click();
      await expect(section.getByRole("radio")).toHaveCount(2);
      expect(await violations(page), "disconnecting").toEqual([]);
    });

    test("waiting, and a deleted calendar with the header's link", async ({ page }) => {
      // A job not yet due, so the page doesn't run it.
      const targetId = await exportAs({});
      await addJob(targetId, "PENDING", "2026-12-31T00:00:00Z");
      await open(page);
      await expect(exportSection(page).getByText("מחובר. ממתין לייצוא.")).toBeVisible();
      expect(await violations(page), "waiting").toEqual([]);

      await db.query(`UPDATE "google_export_target" SET status = 'NEEDS_ACTION'`);
      await open(page);
      await expect(needsAction(page)).toBeVisible();
      await expect(
        exportSection(page).getByRole("button", { name: "צור את היומן מחדש" }),
      ).toBeVisible();
      expect(await violations(page), "calendar deleted").toEqual([]);
      await open(page, "/");
      await expect(needsAction(page)).toBeVisible();
      expect(await violations(page), "the calendar page").toEqual([]);
    });

    test("access revoked: connecting again, and disconnecting", async ({ page }) => {
      await exportAs({ connection: "NEEDS_REAUTH" });
      await open(page);
      const section = exportSection(page);
      await expect(section.getByRole("link", { name: "התחברות מחדש ל-Google" })).toBeVisible();
      expect(await violations(page), "access revoked").toEqual([]);
      await section.getByRole("button", { name: "ניתוק הייצוא" }).click();
      await expect(section.getByText(/יישאר ב-Google, אם כבר נוצר/)).toBeVisible();
      expect(await violations(page), "disconnecting without access").toEqual([]);
    });

    test("coming back from Google: a failure, and a success", async ({ page }) => {
      await open(page, "/settings?google=failed");
      await expect(exportSection(page).getByRole("alert")).toBeVisible();
      expect(await violations(page), "connecting failed").toEqual([]);
      await open(page, "/settings?google=connected");
      await expect(exportSection(page).getByRole("status")).toBeVisible();
      expect(await violations(page), "connected").toEqual([]);
    });
  });
});
