import type { Page } from "@playwright/test";
import { expect, headerDotColor, savedColor, test } from "./fixtures";

const PURPLE = { hex: "#7e22ce", rgb: "rgb(126, 34, 206)" };

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Picks a color and waits until the preview shows it. Retries, because an input made
 * before React has hydrated the form is lost (a real user is never that fast).
 */
async function chooseColor(page: Page, hex: string, how: "swatch" | "custom") {
  await expect(async () => {
    if (how === "swatch") await page.getByRole("radio", { name: hex }).click();
    else {
      // Fill a different value first: re-filling the value the field already holds
      // (from a lost attempt) fires no change in React.
      await page.locator("#custom-color").fill("#000000");
      await page.locator("#custom-color").fill(hex);
    }
    await expect(page.getByTestId("color-preview")).toHaveCSS("background-color", hexToRgb(hex), {
      timeout: 1000,
    });
  }).toPass();
}

test("choosing a color updates the header, the legend and the database", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
  await expect(page.getByRole("heading", { name: "הצבע שלי" })).toBeVisible();

  await chooseColor(page, PURPLE.hex, "swatch");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status")).toHaveText("נשמר");
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

  const taken = page.getByRole("radio", { name: /#be185d/ });
  await expect(taken).toBeDisabled();
  await expect(taken).toHaveAccessibleName(/תפוס/);

  await chooseColor(page, "#c0185f", "custom");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status")).toHaveText("הצבע דומה מדי לצבע של מעיין. בחרו צבע אחר.");

  await chooseColor(page, "#fafafa", "custom");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status")).toContainText("בהיר מדי");

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
