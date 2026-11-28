import type { APIResponse, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Installing the app (spec 8.1): the manifest, the icons made from public/logo.svg, and the
// tags phones read. All public: a phone may read them from the login page.

/** A PNG's width and height, from its header. */
async function pngSize(response: APIResponse) {
  const bytes = await response.body();
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** How opaque (0–255) an image's top-left corner is, drawn in the browser. */
async function cornerAlpha(page: Page, src: string) {
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  }, src);
}

test("the manifest makes it an installable, right-to-left Hebrew app", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "OurCalendar",
    short_name: "OurCalendar",
    description: "יומן משותף לדור ומעיין",
    lang: "he",
    dir: "rtl",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4338ca",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
});

test("every icon is a PNG of its size, without signing in", async ({ request }) => {
  const sizes = {
    "favicon-32.png": 32,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "maskable-192.png": 192,
    "maskable-512.png": 512,
    "apple-touch-icon.png": 180,
  };
  for (const [name, size] of Object.entries(sizes)) {
    const response = await request.get(`/icons/${name}`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()["content-type"], name).toBe("image/png");
    expect(await pngSize(response), name).toEqual([size, size]);
  }
  expect((await request.get("/icons/other.png")).status()).toBe(404);
  // Browsers that still ask for /favicon.ico get the 32×32 icon.
  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(await pngSize(favicon)).toEqual([32, 32]);
  expect((await request.get("/logo.svg")).headers()["content-type"]).toContain("image/svg+xml");
});

test("maskable and iPhone icons fill the square; the others keep rounded corners", async ({
  page,
}) => {
  await page.goto("/login");
  for (const name of ["maskable-192.png", "maskable-512.png", "apple-touch-icon.png"]) {
    expect(await cornerAlpha(page, `/icons/${name}`), name).toBe(255);
  }
  for (const name of ["icon-192.png", "icon-512.png"]) {
    expect(await cornerAlpha(page, `/icons/${name}`), name).toBe(0);
  }
});

test("pages link the manifest and icons, and open without the browser's bar on an iPhone @mobile", async ({
  page,
}) => {
  await page.goto("/login");
  const head = page.locator("head");
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(head.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    "href",
    "/logo.svg",
  );
  await expect(head.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
    "href",
    "/icons/favicon-32.png",
  );
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#4338ca");
  await expect(head.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "OurCalendar",
  );
});

test("the signed-in header shows the logo next to the name @mobile", async ({ page, signInAs }) => {
  await signInAs("dor");
  await page.goto("/settings");
  const logo = page.locator('header img[src="/logo.svg"]');
  await expect(logo).toBeVisible();
  // Decorative: the name next to it says it.
  await expect(logo).toHaveAttribute("alt", "");
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
