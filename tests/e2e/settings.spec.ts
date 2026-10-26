import { expect, headerDotColor, savedColor, test } from "./fixtures";

const PURPLE = { hex: "#7e22ce", rgb: "rgb(126, 34, 206)" };

test("choosing a color updates the header, the legend and the database", async ({
  page,
  signInAs,
}) => {
  await signInAs("dor");
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
  await expect(page.getByRole("heading", { name: "הצבע שלי" })).toBeVisible();

  await page.getByRole("radio", { name: PURPLE.hex }).click();
  await expect(page.getByTestId("color-preview")).toHaveCSS("background-color", PURPLE.rgb);
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

  await page.locator("#custom-color").fill("#c0185f");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status")).toHaveText("הצבע דומה מדי לצבע של מעיין. בחרו צבע אחר.");

  await page.locator("#custom-color").fill("#fafafa");
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
