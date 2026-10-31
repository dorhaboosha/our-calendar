import { expect, insertEvent, test } from "./fixtures";

// The browser's clock is fixed to Thursday 5 November 2026, 09:00 in Israel, so the
// calendar always opens on the same month.
const NOW = new Date("2026-11-05T09:00:00+02:00");
const SHOTS = process.env.E2E_SCREENSHOTS;

const DOR_BLUE = "rgb(29, 78, 216)";
const SHARED_GREEN = "rgb(4, 120, 87)";
const MAAYAN_PINK = "rgb(190, 24, 93)";

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
  await insertEvent({
    title: "ארוחת ערב",
    owner: "shared",
    category: "couple",
    start: "2026-11-05T19:00:00+02:00",
    end: "2026-11-05T21:00:00+02:00",
  });
  await insertEvent({
    title: "חופשה",
    owner: "maayan",
    category: "vacation",
    startDate: "2026-11-12",
    endDate: "2026-11-14",
  });
});

const event = (page: import("@playwright/test").Page, title: string) =>
  page.getByTestId("calendar").getByText(title, { exact: true });

test("month view shows the events of the month in Hebrew, right to left", async ({ page }) => {
  await page.goto("/");
  const calendar = page.getByTestId("calendar");
  await expect(calendar.getByRole("heading", { name: "נובמבר 2026" })).toBeVisible();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(event(page, "ארוחת ערב")).toBeVisible();
  await expect(event(page, "חופשה")).toBeVisible();
  // Time in 24-hour format, and the category as text next to the title.
  await expect(calendar.getByText("10:00", { exact: true })).toBeVisible();
  await expect(calendar.getByText("· אישי")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/month.png`, fullPage: true });
});

test("events are colored by owner", async ({ page }) => {
  await page.goto("/");
  const colorOf = async (title: string) =>
    event(page, title).evaluate((element) => {
      // The colored element is an ancestor of the title text.
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)") return color;
      }
      return null;
    });
  await expect.poll(() => colorOf("רופא שיניים")).toBe(DOR_BLUE);
  await expect.poll(() => colorOf("ארוחת ערב")).toBe(SHARED_GREEN);
  await expect.poll(() => colorOf("חופשה")).toBe(MAAYAN_PINK);
});

test("prev, next, today and the week and day views", async ({ page }) => {
  await page.goto("/");
  const calendar = page.getByTestId("calendar");
  const title = calendar.getByRole("heading", { level: 2 });

  await calendar.getByRole("button", { name: /הבא/ }).click();
  await expect(title).toHaveText("דצמבר 2026");
  await expect(event(page, "רופא שיניים")).toHaveCount(0);

  await calendar.getByRole("button", { name: /היום/ }).click();
  await expect(title).toHaveText("נובמבר 2026");

  await calendar.getByRole("tab", { name: "שבוע" }).click();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/week.png`, fullPage: true });

  await calendar.getByRole("tab", { name: "יום" }).click();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(event(page, "ארוחת ערב")).toBeVisible();
  await expect(event(page, "חופשה")).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/day.png`, fullPage: true });

  await calendar.getByRole("button", { name: /הקודם/ }).click();
  await expect(event(page, "רופא שיניים")).toHaveCount(0);
});

test("an all-day event spans exactly its days", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("calendar").getByRole("tab", { name: "שבוע" }).click();
  await page.getByTestId("calendar").getByRole("button", { name: /הבא/ }).click();
  // Week of 8-14 November: the vacation is on 12 and 13 November only.
  await expect(event(page, "חופשה")).toBeVisible();
  await expect(page.getByTestId("calendar").getByText("כל היום")).toBeVisible();
});

test("shows a message when events can't be loaded", async ({ page, pageErrors }) => {
  await page.route("**/api/events?**", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "לא הצלחנו לטעון" })).toBeVisible();
  // The browser logs the simulated 500; that error is the point of this test.
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((error) => !error.includes("500")));
});

test("the calendar fits a phone screen @mobile", async ({ page }, testInfo) => {
  await page.goto("/");
  const calendar = page.getByTestId("calendar");
  await expect(calendar.getByRole("heading", { name: "נובמבר 2026" })).toBeVisible();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-month.png` });

  await calendar.getByRole("tab", { name: "יום" }).click();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-day.png` });
});
