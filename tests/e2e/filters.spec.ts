import type { Page } from "@playwright/test";
import { expect, insertEvent, test } from "./fixtures";

// Showing and hiding events by owner and category. The clock is Thursday 5 November
// 2026 in Israel, so the calendar opens on November.
const NOW = new Date("2026-11-05T09:00:00+02:00");

const DOR_BLUE = "rgb(29, 78, 216)";
const MAAYAN_PINK = "rgb(190, 24, 93)";
const SHARED_GREEN = "rgb(4, 120, 87)";

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
    title: "ישיבת צוות",
    owner: "maayan",
    category: "work",
    start: "2026-11-06T10:00:00+02:00",
    end: "2026-11-06T11:00:00+02:00",
  });
  await insertEvent({
    title: "ארוחת ערב",
    owner: "shared",
    category: "couple",
    start: "2026-11-05T19:00:00+02:00",
    end: "2026-11-05T21:00:00+02:00",
  });
  await insertEvent({
    title: "מסיבה",
    owner: "maayan",
    category: "other",
    start: "2026-12-03T20:00:00+02:00",
    end: "2026-12-03T23:00:00+02:00",
  });
});

const event = (page: Page, title: string) =>
  page.getByTestId("calendar").getByText(title, { exact: true });
const ownerChip = (page: Page, name: string) =>
  page.getByRole("group", { name: "אירועים של" }).getByRole("button", { name });
const categoryChip = (page: Page, name: string) =>
  page.getByRole("group", { name: "קטגוריות" }).getByRole("button", { name });
const showAll = (page: Page) => page.getByRole("button", { name: "הצגת הכול" });

test("the owner chips are the color legend, and everything is shown at first", async ({ page }) => {
  await page.goto("/?view=month");
  await expect(ownerChip(page, "דור")).toHaveCSS("background-color", DOR_BLUE);
  await expect(ownerChip(page, "מעיין")).toHaveCSS("background-color", MAAYAN_PINK);
  await expect(ownerChip(page, "משותף")).toHaveCSS("background-color", SHARED_GREEN);
  for (const name of ["דור", "מעיין", "משותף"]) {
    await expect(ownerChip(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(showAll(page)).toHaveCount(0);
});

test("hiding an owner hides their events, and showing brings them back", async ({ page }) => {
  await page.goto("/?view=month");
  await expect(event(page, "ישיבת צוות")).toBeVisible();

  await ownerChip(page, "מעיין").click();
  await expect(ownerChip(page, "מעיין")).toHaveAttribute("aria-pressed", "false");
  await expect(ownerChip(page, "מעיין")).toHaveCSS("text-decoration-line", "line-through");
  await expect(event(page, "ישיבת צוות")).toBeHidden();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(event(page, "ארוחת ערב")).toBeVisible();
  await expect(page).toHaveURL(/[?&]hideOwners=maayan(&|$)/);

  await ownerChip(page, "מעיין").click();
  await expect(event(page, "ישיבת צוות")).toBeVisible();
  await expect(page).not.toHaveURL(/hideOwners/);
});

test("categories filter too, combined with owners, and 'show all' resets", async ({ page }) => {
  await page.goto("/?view=month");
  await categoryChip(page, "עבודה").click();
  await expect(event(page, "ישיבת צוות")).toBeHidden();
  await expect(event(page, "רופא שיניים")).toBeVisible();

  await ownerChip(page, "משותף").click();
  await expect(event(page, "ארוחת ערב")).toBeHidden();
  await expect(event(page, "רופא שיניים")).toBeVisible();

  await showAll(page).click();
  await expect(event(page, "ישיבת צוות")).toBeVisible();
  await expect(event(page, "ארוחת ערב")).toBeVisible();
  await expect(showAll(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\?view=month$/);
});

test("filters apply to events loaded later, and survive a refresh", async ({ page }) => {
  await page.goto("/?view=month");
  await ownerChip(page, "מעיין").click();
  await page.getByTestId("calendar").getByRole("button", { name: /הבא/ }).click();
  await expect(page.getByTestId("calendar").getByRole("heading", { level: 2 })).toHaveText(
    "דצמבר 2026",
  );
  // December's events load after the filter was set; Maayan's party stays hidden.
  await expect(page).toHaveURL(/date=2026-12-01/);
  await expect(event(page, "מסיבה")).toBeHidden();

  await page.reload();
  await expect(ownerChip(page, "מעיין")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("calendar").getByRole("button", { name: /הקודם/ }).click();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(event(page, "ישיבת צוות")).toBeHidden();

  await ownerChip(page, "מעיין").click();
  await expect(event(page, "ישיבת צוות")).toBeVisible();
});

test("a link with filters opens with them, ignoring unknown keys", async ({ page }) => {
  await page.goto("/?view=month&hideOwners=dor,someone&hideCategories=couple");
  await expect(event(page, "ישיבת צוות")).toBeVisible();
  await expect(event(page, "רופא שיניים")).toBeHidden();
  await expect(event(page, "ארוחת ערב")).toBeHidden();
  await expect(categoryChip(page, "אירוע זוגי")).toHaveAttribute("aria-pressed", "false");
});

const categoriesToggle = (page: Page) => page.getByRole("button", { name: /סינון לפי קטגוריה/ });

test("on a computer the categories are always shown, with no toggle", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "computer only");
  await page.goto("/?view=month");
  await expect(categoryChip(page, "עבודה")).toBeVisible();
  await expect(categoriesToggle(page)).toBeHidden();
  // Let the events finish loading: a request still running when the test ends would
  // meet the next test's database reset.
  await expect(event(page, "רופא שיניים")).toBeVisible();
});

test("on a phone the categories fold behind a button @mobile", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  await page.goto("/?view=day");
  // The owners, which are also the color legend, stay in view.
  await expect(ownerChip(page, "מעיין")).toBeVisible();
  await expect(page.getByRole("group", { name: "קטגוריות" })).toBeHidden();
  await expect(categoriesToggle(page)).toHaveAttribute("aria-expanded", "false");

  await categoriesToggle(page).click();
  await expect(categoriesToggle(page)).toHaveAttribute("aria-expanded", "true");
  await categoryChip(page, "אישי").click();
  await expect(event(page, "רופא שיניים")).toBeHidden();

  // Folded again, the button still says something is hidden, and "show all" stays at hand.
  await categoriesToggle(page).click();
  await expect(page.getByRole("group", { name: "קטגוריות" })).toBeHidden();
  await expect(categoriesToggle(page)).toHaveText("סינון לפי קטגוריה (אחת מוסתרת)");
  await showAll(page).click();
  await expect(event(page, "רופא שיניים")).toBeVisible();
  await expect(categoriesToggle(page)).toHaveText("סינון לפי קטגוריה");
});

test("saving an event the filters would hide shows its owner and category again", async ({
  page,
}) => {
  await page.goto("/?view=month&hideOwners=maayan&hideCategories=meeting");
  await page.getByRole("button", { name: "אירוע חדש" }).click();
  const form = page.getByRole("dialog", { name: "אירוע חדש" });
  await form.getByLabel("כותרת", { exact: true }).fill("פגישה עם רואה חשבון");
  await form.getByLabel("שייך ל", { exact: true }).selectOption("maayan");
  await form.getByLabel("קטגוריה", { exact: true }).selectOption("meeting");
  await form.getByRole("button", { name: "שמירה" }).click();

  await expect(form).toBeHidden();
  await expect(event(page, "פגישה עם רואה חשבון")).toBeVisible();
  await expect(ownerChip(page, "מעיין")).toHaveAttribute("aria-pressed", "true");
  await expect(categoryChip(page, "פגישה")).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/hide/);
});
