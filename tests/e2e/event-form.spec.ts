import type { Page } from "@playwright/test";
import { db, expect, test } from "./fixtures";

// Creating events from the calendar. The clock is Thursday 5 November 2026, 09:20 in
// Israel, so "new event" defaults to 10:00-11:00 that day.
const NOW = new Date("2026-11-05T09:20:00+02:00");

test.beforeEach(async ({ page, signInAs }) => {
  await page.clock.setFixedTime(NOW);
  await signInAs("maayan");
  await signInAs("dor");
});

const calendar = (page: Page) => page.getByTestId("calendar");
const dialog = (page: Page) => page.getByRole("dialog", { name: "אירוע חדש" });
const field = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });

// No retries needed for clicks inside the calendar: it renders in the browser only, so
// once its button or cells are visible, React is running. (A retry would be harmful: a
// second click lands on the opening dialog's backdrop and closes it.)

async function openNewEvent(page: Page) {
  await page.getByRole("button", { name: "אירוע חדש" }).click();
  await expect(dialog(page)).toBeVisible();
}

async function save(page: Page) {
  await dialog(page).getByRole("button", { name: "שמירה" }).click();
}

async function savedEvents() {
  const { rows } = await db.query(
    `SELECT e.title, e."ownerType", e.category, e."isAllDay", e."startAt", e."endAt",
            to_char(e."startDate", 'YYYY-MM-DD') AS "startDate",
            to_char(e."endDate", 'YYYY-MM-DD') AS "endDate", c."configKey" AS "createdBy"
       FROM "event" e JOIN "user" c ON c.id = e."createdByUserId" ORDER BY e."createdAt"`,
  );
  return rows;
}

// Claude in Chrome once needed two clicks on "יום שלם" in the live check; a real mouse
// click on the label, first thing after the form opens, ticks it.
test('the first click on "יום שלם" ticks it @mobile', async ({ page }) => {
  await page.goto("/");
  await openNewEvent(page);
  await expect(field(page, "כותרת")).toBeFocused();
  const box = (await dialog(page).getByText("יום שלם", { exact: true }).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialog(page).getByRole("checkbox", { name: "יום שלם" })).toBeChecked();
});

test("the button opens the form with sensible defaults", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await expect(field(page, "כותרת")).toBeFocused();
  await expect(field(page, "שייך ל")).toHaveValue("dor");
  await expect(field(page, "קטגוריה")).toHaveValue("other");
  await expect(field(page, "יום שלם")).not.toBeChecked();
  await expect(field(page, "תאריך התחלה")).toHaveValue("2026-11-05");
  await expect(field(page, "שעת התחלה")).toHaveValue("10:00");
  await expect(field(page, "תאריך סיום")).toHaveValue("2026-11-05");
  await expect(field(page, "שעת סיום")).toHaveValue("11:00");
});

test("creates a timed event that appears in the calendar", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "כותרת").fill("רופא שיניים");
  await field(page, "קטגוריה").selectOption("personal");
  await field(page, "מיקום (לא חובה)").fill("רחוב הרצל 1");
  await save(page);

  await expect(dialog(page)).toBeHidden();
  await expect(calendar(page).getByText("רופא שיניים", { exact: true })).toBeVisible();
  expect(await savedEvents()).toEqual([
    {
      title: "רופא שיניים",
      ownerType: "USER",
      category: "personal",
      isAllDay: false,
      startAt: new Date("2026-11-05T08:00:00Z"),
      endAt: new Date("2026-11-05T09:00:00Z"),
      startDate: null,
      endDate: null,
      createdBy: "dor",
    },
  ]);
});

test("moving the start time keeps the length", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "שעת סיום").fill("12:30");
  await field(page, "שעת התחלה").fill("14:00");
  await expect(field(page, "שעת סיום")).toHaveValue("16:30");
});

test("'all day' hides the times and saves dates only", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "כותרת").fill("חופשה");
  await field(page, "שייך ל").selectOption("shared");
  await dialog(page).getByText("יום שלם").click();
  await expect(field(page, "שעת התחלה")).toHaveCount(0);
  await expect(field(page, "שעת סיום")).toHaveCount(0);
  await field(page, "יום אחרון").fill("2026-11-06");
  await save(page);

  await expect(dialog(page)).toBeHidden();
  await expect(calendar(page).getByText("חופשה", { exact: true })).toBeVisible();
  const [event] = await savedEvents();
  // The last day is 6 November; the stored end is the day after it.
  expect(event).toMatchObject({
    ownerType: "SHARED",
    isAllDay: true,
    startAt: null,
    startDate: "2026-11-05",
    endDate: "2026-11-07",
  });
});

test("unticking 'all day' brings the times back from 09:00", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await dialog(page).getByText("יום שלם").click();
  await dialog(page).getByText("יום שלם").click();
  await expect(field(page, "שעת התחלה")).toHaveValue("09:00");
  await expect(field(page, "שעת סיום")).toHaveValue("10:00");
});

test("shows the server's Hebrew errors and keeps the form open", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await save(page);
  await expect(dialog(page).getByText("יש לכתוב כותרת.")).toBeVisible();

  await field(page, "כותרת").fill("פגישה");
  await field(page, "שעת סיום").fill("09:00");
  await save(page);
  await expect(dialog(page).getByText("שעת הסיום צריכה להיות אחרי שעת ההתחלה.")).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  expect(await savedEvents()).toEqual([]);
});

test("creates a weekly series that appears on each of its days", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "כותרת").fill("פילאטיס");
  await expect(dialog(page).getByText("בימים")).toHaveCount(0);
  await field(page, "חזרה").selectOption("weekly");
  // Thursday, the start's day, is chosen to begin with.
  await expect(field(page, "חמישי")).toBeChecked();
  await dialog(page).getByText("ראשון", { exact: true }).click();
  await field(page, "סיום החזרה").selectOption("count");
  await field(page, "מספר פעמים").fill("4");
  await save(page);

  await expect(dialog(page)).toBeHidden();
  // Thursday 5, Sunday 8, Thursday 12 and Sunday 15 November.
  await expect(calendar(page).getByText("פילאטיס", { exact: true })).toHaveCount(4);
  const { rows } = await db.query('SELECT rrule FROM "event"');
  expect(rows).toEqual([{ rrule: "FREQ=WEEKLY;BYDAY=SU,TH;WKST=SU;COUNT=4" }]);
});

test("a weekly series must include the start's day", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "כותרת").fill("פילאטיס");
  await field(page, "חזרה").selectOption("biweekly");
  await dialog(page).getByText("חמישי", { exact: true }).click();
  await dialog(page).getByText("שני", { exact: true }).click();
  await save(page);
  await expect(
    dialog(page).getByText("היום של תאריך ההתחלה צריך להיות אחד הימים שנבחרו."),
  ).toBeVisible();
  expect(await savedEvents()).toEqual([]);
});

test("cancel closes the form without saving", async ({ page }) => {
  await page.goto("/?view=month");
  await openNewEvent(page);
  await field(page, "כותרת").fill("לא נשמר");
  await dialog(page).getByRole("button", { name: "ביטול" }).click();
  await expect(dialog(page)).toBeHidden();
  expect(await savedEvents()).toEqual([]);

  // Opening again starts from fresh values.
  await openNewEvent(page);
  await expect(field(page, "כותרת")).toHaveValue("");
});

test("clicking a day in the month view starts a new event on that day", async ({ page }) => {
  await page.goto("/?view=month");
  await calendar(page).locator('[role="cell"][data-date="2026-11-12"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(field(page, "תאריך התחלה")).toHaveValue("2026-11-12");
  await expect(field(page, "שעת התחלה")).toHaveValue("09:00");
});

test("clicking a time in the day view starts a new event at that time", async ({ page }) => {
  await page.goto("/?view=day");
  // The slot row itself doesn't take pointer events (FullCalendar listens on the layer
  // underneath), so click its spot on the screen, as a user would.
  const slot = calendar(page).locator('[data-time="14:00:00"]').last();
  await expect(slot).toBeVisible();
  const box = (await slot.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialog(page)).toBeVisible();
  await expect(field(page, "שעת התחלה")).toHaveValue("14:00");
  await expect(field(page, "שעת סיום")).toHaveValue("15:00");
});

test("the form fills a phone screen @mobile", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  await page.goto("/");
  await openNewEvent(page);
  // Polled: the dialog scales in, so it is narrower for a moment while opening.
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => (await dialog(page).boundingBox())?.width)
    .toBeGreaterThanOrEqual(viewport.width - 1);
  await field(page, "כותרת").fill("ארוחת ערב");
  await save(page);
  await expect(dialog(page)).toBeHidden();
  await expect(calendar(page).getByText("ארוחת ערב", { exact: true })).toBeVisible();
});
