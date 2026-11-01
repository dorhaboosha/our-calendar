import type { Page } from "@playwright/test";
import { db, expect, insertEvent, test } from "./fixtures";

// Viewing, editing and deleting events. The clock is Thursday 5 November 2026, 09:20
// in Israel; Dor is signed in unless a test says otherwise.
const NOW = new Date("2026-11-05T09:20:00+02:00");

let dentistId: string;
let vacationId: string;

test.beforeEach(async ({ page, signInAs }) => {
  await page.clock.setFixedTime(NOW);
  await signInAs("maayan");
  await signInAs("dor");
  dentistId = await insertEvent({
    title: "רופא שיניים",
    owner: "dor",
    category: "personal",
    start: "2026-11-05T10:00:00+02:00",
    end: "2026-11-05T11:00:00+02:00",
    location: "רחוב הרצל 1",
    description: "להביא את הכרטיס\nולהגיע מוקדם",
  });
  vacationId = await insertEvent({
    title: "חופשה",
    owner: "maayan",
    category: "vacation",
    startDate: "2026-11-12",
    endDate: "2026-11-14",
  });
});

const calendar = (page: Page) => page.getByTestId("calendar");
const eventButton = (page: Page, title: string) =>
  calendar(page)
    .getByRole("button", { name: new RegExp(title) })
    .first();
const details = (page: Page, title: string) => page.getByRole("dialog", { name: title });
const editForm = (page: Page) => page.getByRole("dialog", { name: "עריכת אירוע" });
const field = (page: Page, label: string) => editForm(page).getByLabel(label, { exact: true });
const confirmDelete = (page: Page) => page.getByRole("alertdialog", { name: "למחוק את האירוע?" });

async function openDetails(page: Page, title: string) {
  await eventButton(page, title).click();
  await expect(details(page, title)).toBeVisible();
}

async function savedEvent(id: string) {
  const { rows } = await db.query(
    `SELECT e.title, e."ownerType", e."startAt", e."endAt",
            to_char(e."endDate", 'YYYY-MM-DD') AS "endDate", e.version,
            e."deletedAt" IS NOT NULL AS deleted, u."configKey" AS "updatedBy"
       FROM "event" e JOIN "user" u ON u.id = e."updatedByUserId" WHERE e.id = $1`,
    [id],
  );
  return rows[0];
}

test("clicking an event shows its details", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "רופא שיניים");
  const dialog = details(page, "רופא שיניים");
  await expect(dialog.getByText("יום חמישי, 5 בנובמבר 2026")).toBeVisible();
  await expect(dialog.getByText("10:00–11:00")).toBeVisible();
  await expect(dialog.getByText("דור", { exact: true })).toBeVisible();
  await expect(dialog.getByText("אישי", { exact: true })).toBeVisible();
  await expect(dialog.getByText("רחוב הרצל 1")).toBeVisible();
  await expect(dialog.getByText(/להביא את הכרטיס\s+ולהגיע מוקדם/)).toBeVisible();
  await expect(dialog).toContainText("נוצר על ידי דור");
  await expect(dialog).not.toContainText("נערך לאחרונה");

  await dialog.getByRole("button", { name: "סגירה" }).click();
  await expect(dialog).toBeHidden();
});

test("an event opens from the keyboard too", async ({ page }) => {
  await page.goto("/?view=month");
  await eventButton(page, "רופא שיניים").focus();
  await page.keyboard.press("Enter");
  await expect(details(page, "רופא שיניים")).toBeVisible();
});

test("an all-day event shows its first and last day", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "חופשה");
  const dialog = details(page, "חופשה");
  await expect(dialog.getByText("12 בנובמבר 2026 – 13 בנובמבר 2026")).toBeVisible();
  await expect(dialog.getByText("יום שלם")).toBeVisible();
  await expect(dialog.getByText("מעיין", { exact: true })).toBeVisible();
});

test("editing an event saves it and shows who edited it", async ({ page, signInAs }) => {
  await signInAs("maayan");
  await page.goto("/?view=month");
  await openDetails(page, "רופא שיניים");
  await details(page, "רופא שיניים").getByRole("button", { name: "עריכה" }).click();

  // The form opens with the event's values.
  await expect(field(page, "כותרת")).toHaveValue("רופא שיניים");
  await expect(field(page, "שייך ל")).toHaveValue("dor");
  await expect(field(page, "שעת התחלה")).toHaveValue("10:00");
  await expect(field(page, "שעת סיום")).toHaveValue("11:00");
  await expect(field(page, "מיקום (לא חובה)")).toHaveValue("רחוב הרצל 1");

  await field(page, "כותרת").fill("רופא שיניים - ביקורת");
  await field(page, "שייך ל").selectOption("shared");
  await field(page, "שעת התחלה").fill("12:00");
  await editForm(page).getByRole("button", { name: "שמירה" }).click();

  await expect(editForm(page)).toBeHidden();
  await expect(calendar(page).getByText("רופא שיניים - ביקורת", { exact: true })).toBeVisible();
  expect(await savedEvent(dentistId)).toMatchObject({
    title: "רופא שיניים - ביקורת",
    ownerType: "SHARED",
    startAt: new Date("2026-11-05T10:00:00Z"),
    endAt: new Date("2026-11-05T11:00:00Z"),
    version: 2,
    updatedBy: "maayan",
  });

  await openDetails(page, "רופא שיניים - ביקורת");
  await expect(details(page, "רופא שיניים - ביקורת")).toContainText(
    "נוצר על ידי דור · נערך לאחרונה על ידי מעיין",
  );
});

test("editing an all-day event shows and saves its last day", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "חופשה");
  await details(page, "חופשה").getByRole("button", { name: "עריכה" }).click();
  await expect(field(page, "יום שלם")).toBeChecked();
  await expect(field(page, "תאריך התחלה")).toHaveValue("2026-11-12");
  await expect(field(page, "יום אחרון")).toHaveValue("2026-11-13");

  await field(page, "יום אחרון").fill("2026-11-15");
  await editForm(page).getByRole("button", { name: "שמירה" }).click();
  await expect(editForm(page)).toBeHidden();
  expect(await savedEvent(vacationId)).toMatchObject({ endDate: "2026-11-16", version: 2 });
});

test("deleting asks first, and cancel goes back to the details", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "רופא שיניים");
  await details(page, "רופא שיניים").getByRole("button", { name: "מחיקה" }).click();

  const confirm = confirmDelete(page);
  await expect(confirm).toContainText('האירוע "רופא שיניים" יימחק מהיומן של שניכם.');
  // Focus starts on "cancel", so pressing Enter by habit doesn't delete.
  await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused();
  await confirm.getByRole("button", { name: "ביטול" }).click();
  await expect(details(page, "רופא שיניים")).toBeVisible();
  expect(await savedEvent(dentistId)).toMatchObject({ deleted: false, version: 1 });

  await details(page, "רופא שיניים").getByRole("button", { name: "מחיקה" }).click();
  await confirm.getByRole("button", { name: "מחיקה" }).click();
  await expect(confirm).toBeHidden();
  await expect(calendar(page).getByText("רופא שיניים", { exact: true })).toHaveCount(0);
  // Soft delete: the row stays for the Google export, marked deleted.
  expect(await savedEvent(dentistId)).toMatchObject({ deleted: true, version: 2 });
});

test("an edit made meanwhile by the other user is not overwritten", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "רופא שיניים");
  await details(page, "רופא שיניים").getByRole("button", { name: "עריכה" }).click();
  await expect(editForm(page)).toBeVisible();

  // Maayan saves the same event while the form is open.
  await db.query(`UPDATE "event" SET title = 'רופא שיניים - נדחה', version = 2 WHERE id = $1`, [
    dentistId,
  ]);
  await field(page, "כותרת").fill("שלי");
  await editForm(page).getByRole("button", { name: "שמירה" }).click();

  await expect(
    editForm(page).getByText("האירוע שונה בינתיים. טענו אותו מחדש ונסו שוב."),
  ).toBeVisible();
  expect(await savedEvent(dentistId)).toMatchObject({ title: "רופא שיניים - נדחה", version: 2 });
  // The calendar has reloaded in the background: closing the form shows her version.
  await editForm(page).getByRole("button", { name: "ביטול" }).click();
  await expect(calendar(page).getByText("רופא שיניים - נדחה", { exact: true })).toBeVisible();
});

test("deleting an event already deleted by the other user says so", async ({ page }) => {
  await page.goto("/?view=month");
  await openDetails(page, "רופא שיניים");
  await details(page, "רופא שיניים").getByRole("button", { name: "מחיקה" }).click();
  await db.query(`UPDATE "event" SET "deletedAt" = now(), version = 2 WHERE id = $1`, [dentistId]);
  await confirmDelete(page).getByRole("button", { name: "מחיקה" }).click();
  await expect(confirmDelete(page).getByText("האירוע כבר לא קיים. ייתכן שהוא נמחק.")).toBeVisible();
  await confirmDelete(page).getByRole("button", { name: "ביטול" }).click();
  await details(page, "רופא שיניים").getByRole("button", { name: "סגירה" }).click();
  await expect(calendar(page).getByText("רופא שיניים", { exact: true })).toHaveCount(0);
});

test("details and editing fill a phone screen @mobile", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  await page.goto("/");
  await openDetails(page, "רופא שיניים");
  const viewport = page.viewportSize()!;
  // Polled: the dialog scales in, so it is narrower for a moment while opening.
  await expect
    .poll(async () => (await details(page, "רופא שיניים").boundingBox())?.width)
    .toBeGreaterThanOrEqual(viewport.width - 1);

  await details(page, "רופא שיניים").getByRole("button", { name: "עריכה" }).click();
  await field(page, "כותרת").fill("רופא שיניים בטלפון");
  await editForm(page).getByRole("button", { name: "שמירה" }).click();
  await expect(editForm(page)).toBeHidden();
  await expect(calendar(page).getByText("רופא שיניים בטלפון", { exact: true })).toBeVisible();
});
