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

test("no English is left in the calendar, even in texts only screen readers hear", async ({
  page,
}) => {
  // Enough events on one day for month view to fold some behind "+N נוספים".
  for (let hour = 12; hour < 17; hour++) {
    await insertEvent({
      title: `פגישה ${hour}`,
      owner: "dor",
      start: `2026-11-05T${hour}:00:00+02:00`,
      end: `2026-11-05T${hour}:30:00+02:00`,
    });
  }
  // Visible text, hidden text and accessible labels with Latin letters in them.
  const englishIn = (root: import("@playwright/test").Locator) =>
    root.evaluate((element) => {
      const found: string[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (/[A-Za-z]{2,}/.test(node.textContent!)) found.push(node.textContent!.trim());
      }
      for (const labelled of element.querySelectorAll("[aria-label], [title]")) {
        for (const name of ["aria-label", "title"]) {
          const value = labelled.getAttribute(name);
          if (value && /[A-Za-z]{2,}/.test(value)) found.push(value);
        }
      }
      return found;
    });

  for (const view of ["month", "week", "day"]) {
    await page.goto(`/?view=${view}`);
    await expect(event(page, "רופא שיניים")).toBeVisible();
    expect(await englishIn(page.getByTestId("calendar")), view).toEqual([]);
  }
  // The "+N נוספים" popover opens outside the calendar's box; its close button was
  // labelled "Close".
  await page.goto("/?view=month");
  await page
    .getByTestId("calendar")
    .getByRole("button", { name: /נוספים/ })
    .click();
  await expect(page.getByRole("button", { name: "סגירה" })).toBeVisible();
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

test("the calendar fits a phone screen, in month and day views @mobile", async ({
  page,
}, testInfo) => {
  await page.goto("/?view=month");
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

test.describe("navigation", () => {
  const title = (page: import("@playwright/test").Page) =>
    page.getByTestId("calendar").getByRole("heading", { level: 2 });

  test("opens in month view on a computer, and keeps today out of the URL", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "computer only");
    await page.goto("/");
    await expect(title(page)).toHaveText("נובמבר 2026");
    await expect(page).toHaveURL(/\?view=month$/);
  });

  test("opens in day view on a phone @mobile", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "phone only");
    await page.goto("/");
    await expect(title(page)).toHaveText("5 בנובמבר 2026");
    await expect(event(page, "רופא שיניים")).toBeVisible();
    await expect(page).toHaveURL(/\?view=day$/);
  });

  test("keeps the view and date in the URL, so a refresh stays in place", async ({ page }) => {
    await page.goto("/?view=month");
    const calendar = page.getByTestId("calendar");
    await calendar.getByRole("tab", { name: "שבוע" }).click();
    // "Next" in week view moves to the start of the next week (Sunday 8 November).
    await calendar.getByRole("button", { name: /הבא/ }).click();
    await expect(page).toHaveURL(/\?view=week&date=2026-11-08$/);

    await page.reload();
    await expect(calendar.getByRole("tab", { name: "שבוע" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(event(page, "חופשה")).toBeVisible();
  });

  test("opens the place in a shared link", async ({ page }) => {
    await page.goto("/?view=day&date=2026-11-12");
    await expect(title(page)).toHaveText("12 בנובמבר 2026");
    await expect(event(page, "חופשה")).toBeVisible();
  });

  test("ignores an invalid view or date in the URL", async ({ page }) => {
    await page.goto("/?view=year&date=2026-02-30");
    await expect(title(page)).toHaveText(/נובמבר 2026/);
  });

  test("the date picker jumps to any date", async ({ page }) => {
    await page.goto("/?view=month");
    const picker = page.getByLabel("מעבר לתאריך");
    await expect(picker).toHaveValue("2026-11-05");
    await picker.fill("2027-03-26");
    await expect(title(page)).toHaveText("מרץ 2027");
    await expect(page).toHaveURL(/\?view=month&date=2027-03-26$/);

    // Navigating with the arrows updates the picker too.
    await page.getByTestId("calendar").getByRole("button", { name: /היום/ }).click();
    await expect(picker).toHaveValue("2026-11-05");
  });

  test("on a phone the date picker closes once a date is picked @mobile", async ({ page }) => {
    const picker = page.getByLabel("מעבר לתאריך");
    await page.goto("/?view=day");
    await expect(event(page, "רופא שיניים")).toBeVisible();
    await picker.focus();
    await picker.fill("2026-11-12");
    await expect(title(page)).toHaveText("12 בנובמבר 2026");
    if (test.info().project.name === "mobile") {
      // Leaving the field is what closes the iPhone's picker.
      await expect(picker).not.toBeFocused();
    } else {
      // On a computer the field keeps focus, so a date can be typed digit by digit.
      await expect(picker).toBeFocused();
    }
  });

  test("the picked date is outlined in the month and week views", async ({ page }) => {
    await page.goto("/?view=month");
    const calendar = page.getByTestId("calendar");
    const picked = calendar.locator(".picked-date");
    await expect(picked).toHaveCount(0);

    await page.getByLabel("מעבר לתאריך").fill("2027-03-26");
    await expect(picked).toHaveCount(1);
    await expect(picked).toHaveAttribute("data-date", "2027-03-26");
    await expect(picked).toHaveCSS("outline-style", "solid");

    // Switching to the week view keeps it; the arrows move away and clear it.
    await calendar.getByRole("tab", { name: "שבוע" }).click();
    await expect(picked.first()).toHaveAttribute("data-date", "2027-03-26");
    await calendar.getByRole("button", { name: /הבא/ }).click();
    await calendar.getByRole("button", { name: /הקודם/ }).click();
    await expect(picked).toHaveCount(0);
  });
});
