import { expect, test } from "./fixtures";

// Security headers on every response (next.config.ts): pages, the API, and files.
const EXPECTED = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

test("pages, the API and files send the security headers, and not x-powered-by", async ({
  request,
}) => {
  for (const path of ["/login", "/privacy", "/api/health", "/api/events", "/logo.svg"]) {
    const headers = (await request.get(path, { maxRedirects: 0 })).headers();
    expect(headers, path).toMatchObject(EXPECTED);
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("no page can show the app in a frame, not even its own", async ({ page, pageErrors }) => {
  await page.goto("/privacy");
  const blocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement("iframe");
        frame.src = "/login";
        frame.onload = () => {
          // A blocked frame loads an empty error page that the parent can't read into.
          try {
            resolve(!frame.contentDocument?.body?.innerText.includes("OurCalendar"));
          } catch {
            resolve(true);
          }
        };
        document.body.append(frame);
      }),
  );
  expect(blocked).toBe(true);
  // The browser reports the refusal; that is the point of this test.
  expect(pageErrors.some((error) => error.includes("frame-ancestors"))).toBe(true);
  pageErrors.splice(
    0,
    pageErrors.length,
    ...pageErrors.filter((error) => !/frame|X-Frame-Options/.test(error)),
  );
});
