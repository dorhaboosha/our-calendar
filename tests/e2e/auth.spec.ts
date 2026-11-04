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

  test("the login page says what the site is and that Google handles the password", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByText("יומן פרטי ומשותף של דור ומעיין.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("האתר הזה לא מבקש ולא שומר סיסמאות", { exact: false }),
    ).toBeVisible();
  });

  test("serves the Google Search Console verification file without a redirect", async ({
    request,
  }) => {
    const response = await request.get("/google4e80a75d4e54cc97.html", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("google-site-verification: google4e80a75d4e54cc97.html");
  });

  test("the privacy policy is public and linked from the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "מדיניות פרטיות" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "מדיניות פרטיות" })).toBeVisible();
    await expect(page.getByText("Limited Use requirements")).toBeVisible();
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
    let googleUrl: URL | undefined;
    await page.route("https://accounts.google.com/**", (route) => {
      googleUrl = new URL(route.request().url());
      return route.abort();
    });
    // Retried: a click before React has hydrated the button does nothing. Once a click
    // has worked, the page is on its way to Google and the button is gone.
    await expect(async () => {
      if (!googleUrl) {
        await page.getByRole("button", { name: "התחברות עם Google" }).click({ timeout: 1000 });
      }
      await expect.poll(() => googleUrl, { timeout: 3000 }).toBeDefined();
    }).toPass();
    expect(googleUrl!.searchParams.get("redirect_uri")).toBe(
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
    // Wait for the calendar's first request, like a user who looks before signing out;
    // signing out mid-request would (correctly) answer it with 401.
    const eventsLoaded = page.waitForResponse((response) => response.url().includes("/api/events"));
    await page.goto("/");
    await eventsLoaded;
    // Retried: a click before React has hydrated the button does nothing.
    await expect(async () => {
      await page.getByRole("button", { name: "התנתקות" }).click({ timeout: 1000 });
      await expect(page).toHaveURL(/\/login$/, { timeout: 2000 });
    }).toPass();

    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a failed sign out stays signed in, and can be tried again", async ({
    page,
    pageErrors,
    signInAs,
  }) => {
    await signInAs("dor");
    await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500 }));
    const eventsLoaded = page.waitForResponse((response) => response.url().includes("/api/events"));
    await page.goto("/");
    await eventsLoaded;
    // Going to /login with the session still valid would only bounce back here, so the
    // end state alone can't tell; the page must not try to leave at all.
    let leftForLogin = false;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.url().includes("/login")) leftForLogin = true;
    });
    const signOut = page.getByRole("button", { name: "התנתקות" });
    // Retried, as above: a click before React has hydrated the button does nothing.
    await expect(async () => {
      const request = page.waitForRequest("**/api/auth/sign-out", { timeout: 1000 });
      await signOut.click({ timeout: 1000 });
      await request;
    }).toPass();

    await expect(signOut).toBeEnabled();
    expect(leftForLogin).toBe(false);
    await expect(page.getByRole("banner")).toContainText("שלום, דור");
    // The browser logs the simulated 500; that error is the point of this test.
    pageErrors.splice(
      0,
      pageErrors.length,
      ...pageErrors.filter((error) => !error.includes("500")),
    );
  });
});
