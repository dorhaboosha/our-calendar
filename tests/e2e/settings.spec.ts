import type { Locator, Page } from "@playwright/test";
import {
  db,
  expect,
  headerDotColor,
  insertEvent,
  savedColor,
  savedSharedColor,
  test,
} from "./fixtures";

const PURPLE = { hex: "#7e22ce", rgb: "rgb(126, 34, 206)" };
const OLIVE = { hex: "#4d7c0f", rgb: "rgb(77, 124, 15)" };

// The settings page has one section per color; each holds its own color form.
const myColor = (page: Page) => page.getByRole("region", { name: "הצבע שלי" });
const sharedColor = (page: Page) => page.getByRole("region", { name: "צבע האירועים המשותפים" });

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Picks a color and waits until the preview shows it. Retries, because an input made
 * before React has hydrated the form is lost (a real user is never that fast).
 */
async function chooseColor(section: Locator, hex: string, how: "swatch" | "custom") {
  const custom = section.getByLabel("צבע מותאם אישית");
  await expect(async () => {
    if (how === "swatch") await section.getByRole("radio", { name: hex }).click();
    else {
      // Fill a different value first: re-filling the value the field already holds
      // (from a lost attempt) fires no change in React.
      await custom.fill("#000000");
      await custom.fill(hex);
    }
    await expect(section.getByTestId("color-preview")).toHaveCSS(
      "background-color",
      hexToRgb(hex),
      { timeout: 1000 },
    );
  }).toPass();
}

async function save(section: Locator) {
  await section.getByRole("button", { name: "שמירה" }).click();
}

test("choosing a color updates the header, the legend and the database", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
  await expect(page.getByRole("heading", { name: "הצבע שלי" })).toBeVisible();

  await chooseColor(myColor(page), PURPLE.hex, "swatch");
  await save(myColor(page));
  await expect(myColor(page).getByRole("status")).toHaveText("נשמר");
  await expect.poll(() => headerDotColor(page)).toBe(PURPLE.rgb);

  expect(await savedColor("dor")).toBe(PURPLE.hex);

  await page.getByRole("banner").getByRole("link", { name: "יומן" }).click();
  await expect(page.getByRole("main").getByText("דור", { exact: true })).toHaveCSS(
    "background-color",
    PURPLE.rgb,
  );
});

test("the other user's color is not available, and too-close colors are refused", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  await page.goto("/settings");

  const taken = myColor(page).getByRole("radio", { name: /#be185d/ });
  await expect(taken).toBeDisabled();
  await expect(taken).toHaveAccessibleName(/תפוס/);

  await chooseColor(myColor(page), "#c0185f", "custom");
  await save(myColor(page));
  await expect(myColor(page).getByRole("status")).toHaveText(
    "הצבע דומה מדי לצבע של מעיין. בחרו צבע אחר.",
  );

  await chooseColor(myColor(page), "#fafafa", "custom");
  await save(myColor(page));
  await expect(myColor(page).getByRole("status")).toContainText("בהיר מדי");

  expect(await savedColor("dor")).toBeNull();
});

test("users see each other's chosen colors in the legend", async ({ page, signInAs }) => {
  await signInAs("maayan", PURPLE.hex);
  await signInAs("dor");
  await page.goto("/");
  await expect(page.getByRole("main").getByText("מעיין", { exact: true })).toHaveCSS(
    "background-color",
    PURPLE.rgb,
  );
});

test("either user can change the shared-events color", async ({ page, signInAs }) => {
  await page.clock.setFixedTime(new Date("2026-11-05T09:00:00+02:00"));
  await signInAs("dor");
  await signInAs("maayan");
  await insertEvent({
    title: "ארוחת ערב",
    owner: "shared",
    start: "2026-11-05T19:00:00+02:00",
    end: "2026-11-05T21:00:00+02:00",
  });
  await page.goto("/settings");
  // The default is chosen until someone picks another color.
  await expect(sharedColor(page).getByRole("radio", { name: "#047857" })).toBeChecked();

  await chooseColor(sharedColor(page), OLIVE.hex, "swatch");
  await save(sharedColor(page));
  await expect(sharedColor(page).getByRole("status")).toHaveText("נשמר");
  expect(await savedSharedColor()).toBe(OLIVE.hex);

  await page.getByRole("banner").getByRole("link", { name: "יומן" }).click();
  await expect(page.getByRole("main").getByText("משותף", { exact: true })).toHaveCSS(
    "background-color",
    OLIVE.rgb,
  );
  // The event's colored block is an ancestor of its title.
  const eventColor = () =>
    page
      .getByTestId("calendar")
      .getByText("ארוחת ערב", { exact: true })
      .evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        return null;
      });
  await expect.poll(eventColor).toBe(OLIVE.rgb);
});

test("the form follows a color the other user saved, but keeps a pick not yet saved", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  // As if Maayan saved it from her own phone.
  const otherUserSaves = (hex: string) =>
    db.query(
      `INSERT INTO "shared_settings" ("id", "sharedColor", "updatedAt") VALUES (1, $1, now())
       ON CONFLICT ("id") DO UPDATE SET "sharedColor" = $1`,
      [hex],
    );
  const visitCalendarAndBack = async () => {
    await page.getByRole("banner").getByRole("link", { name: "יומן" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  };
  await page.goto("/settings");
  await expect(sharedColor(page).getByRole("radio", { name: "#047857" })).toBeChecked();

  await otherUserSaves(OLIVE.hex);
  await visitCalendarAndBack();
  await expect(sharedColor(page).getByRole("radio", { name: OLIVE.hex })).toBeChecked();

  await chooseColor(sharedColor(page), PURPLE.hex, "swatch");
  await otherUserSaves("#047857");
  await visitCalendarAndBack();
  await expect(sharedColor(page).getByRole("radio", { name: PURPLE.hex })).toBeChecked();
});

test("the shared color and the personal colors keep apart, both ways", async ({
  page,
  signInAs,
}) => {
  await signInAs("maayan", PURPLE.hex);
  await signInAs("dor");
  await page.goto("/settings");

  // The shared color can't take a user's color...
  await expect(sharedColor(page).getByRole("radio", { name: /#7e22ce/ })).toBeDisabled();
  await expect(sharedColor(page).getByRole("radio", { name: /#1d4ed8/ })).toBeDisabled();
  await chooseColor(sharedColor(page), "#7f23cf", "custom");
  await save(sharedColor(page));
  await expect(sharedColor(page).getByRole("status")).toHaveText(
    "הצבע דומה מדי לצבע של מעיין. בחרו צבע אחר.",
  );
  expect(await savedSharedColor()).toBeNull();

  // ...and once it changes, a user's color can't take the new shared color.
  await expect(myColor(page).getByRole("radio", { name: /#4d7c0f/ })).toBeEnabled();
  await chooseColor(sharedColor(page), OLIVE.hex, "swatch");
  await save(sharedColor(page));
  await expect(sharedColor(page).getByRole("status")).toHaveText("נשמר");
  await expect(myColor(page).getByRole("radio", { name: /#4d7c0f/ })).toBeDisabled();
  // The old shared color is free again.
  await expect(myColor(page).getByRole("radio", { name: "#047857" })).toBeEnabled();
});

test("pages fit a phone screen without horizontal scrolling @mobile", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  for (const path of ["/", "/settings", "/login?error=not_allowed"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
