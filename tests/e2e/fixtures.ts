import { createHmac, randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";
import { E2E_BASE_URL, E2E_ENV } from "../../playwright.config";

export { expect };

type UserKey = "dor" | "maayan";

// Plain SQL rather than the app's Prisma client: the generated client is an ES module,
// which Playwright's CommonJS test loader cannot import. One pool per worker process;
// allowExitOnIdle lets the worker exit without an explicit end().
export const db = new pg.Pool({
  connectionString: E2E_ENV.DATABASE_URL,
  max: 2,
  allowExitOnIdle: true,
});

/** Removes all users (sessions and accounts cascade) so every test starts clean. */
export async function resetDatabase() {
  await db.query('DELETE FROM "user"');
}

/** The color saved for a user, or null for the default. */
export async function savedColor(key: UserKey): Promise<string | null> {
  const { rows } = await db.query('SELECT color FROM "user" WHERE "configKey" = $1', [key]);
  return rows[0]?.color ?? null;
}

/** The value of a Better Auth session cookie: the token, signed with the app secret. */
function signedCookieValue(token: string) {
  const signature = createHmac("sha256", E2E_ENV.BETTER_AUTH_SECRET).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Signs the page in as a user without going through Google: creates the user and a
 * session in the test database, and sets the session cookie in the browser.
 */
async function signInAs(page: Page, key: UserKey, color: string | null = null) {
  const email = key === "dor" ? E2E_ENV.USER_EMAIL_DOR : E2E_ENV.USER_EMAIL_MAAYAN;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO "user" (id, name, email, "emailVerified", "configKey", color, "updatedAt")
     VALUES ($1, $2, $3, true, $4, $5, now())
     ON CONFLICT ("configKey") DO UPDATE SET color = EXCLUDED.color
     RETURNING id`,
    [randomUUID(), key, email, key, color],
  );
  const userId = rows[0].id;
  const token = randomUUID().replaceAll("-", "");
  await db.query(
    `INSERT INTO session (id, token, "userId", "expiresAt", "updatedAt")
     VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
    [randomUUID(), token, userId],
  );
  await page
    .context()
    .addCookies([
      { name: "better-auth.session_token", value: signedCookieValue(token), url: E2E_BASE_URL },
    ]);
  return { id: userId };
}

type Fixtures = {
  /** Every test starts with an empty database. */
  cleanDatabase: void;
  /** Browser errors collected during the test; the test fails if any remain. */
  pageErrors: string[];
  signInAs: (key: UserKey, color?: string | null) => ReturnType<typeof signInAs>;
};

// Fixtures rather than beforeEach/afterAll hooks here: hooks declared in a shared
// module only attach to the first test file that imports it.
export const test = base.extend<Fixtures>({
  cleanDatabase: [
    async ({}, use) => {
      await resetDatabase();
      await use();
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await use(errors);
      // Hydration mismatches and other runtime errors fail the test.
      expect(errors, "browser errors during the test").toEqual([]);
    },
    { auto: true },
  ],
  signInAs: async ({ page }, use) => {
    await use((key, color = null) => signInAs(page, key, color));
  },
});

/** Background color of the colored dot next to the user's name in the header. */
export function headerDotColor(page: Page) {
  return page
    .locator("header [aria-hidden]")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
}
