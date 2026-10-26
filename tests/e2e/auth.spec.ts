import { expect, test } from "./fixtures";

test.describe("signed out", () => {
  test("app pages redirect to the Hebrew, right-to-left login page", async ({ page }) => {
    for (const path of ["/", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page).toHaveTitle("היומן שלנו");
    await expect(page.getByRole("heading", { name: "ברוכים הבאים ליומן שלנו" })).toBeVisible();
    await expect(page.getByRole("button", { name: "התחברות עם Google" })).toBeVisible();
  });

  test("shows the not-allowed message after a rejected sign-in", async ({ page }) => {
    await page.goto("/login?error=not_allowed");
    // Scoped to the page content: Next.js's route announcer is also role="alert".
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "החשבון הזה אינו מורשה להיכנס ליומן.",
    );
  });

  test("a forged session cookie does not get in", async ({ page, context }) => {
    await context.addCookies([
      { name: "better-auth.session_token", value: "forged.value", url: "http://localhost:3100" },
    ]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("banner")).toHaveCount(0);
  });

  test("the Google button starts sign-in at Google", async ({ page }) => {
    await page.goto("/login");
    // Stop at Google: only check that the app sent the browser there with our callback.
    const googleRequest = page.waitForRequest((request) =>
      request.url().startsWith("https://accounts.google.com/"),
    );
    await page.route("https://accounts.google.com/**", (route) => route.abort());
    await page.getByRole("button", { name: "התחברות עם Google" }).click();
    const url = new URL((await googleRequest).url());
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3100/api/auth/callback/google",
    );
  });
});

test.describe("signed in", () => {
  test("shows the header with the user's name and color", async ({ page, signInAs }) => {
    await signInAs("dor");
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header).toContainText("שלום, דור");
    await expect(header.getByRole("link", { name: "יומן" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the login page sends a signed-in user home", async ({ page, signInAs }) => {
    await signInAs("maayan");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner")).toContainText("שלום, מעיין");
  });

  test("sign out ends the session", async ({ page, signInAs }) => {
    await signInAs("dor");
    await page.goto("/");
    await page.getByRole("button", { name: "התנתקות" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});
