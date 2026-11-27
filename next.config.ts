import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Sent with every response. No full Content-Security-Policy (scripts would need nonces);
 * these close the common holes: no page of the app inside another site's frame (so no
 * click on "disconnect" or "delete" can be tricked), HTTPS only, no guessing of file
 * types, no full URL sent to other sites, and no camera, microphone or location.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Next.js 16 defaults; both become mandatory in the next major version.
  cacheComponents: true,
  partialPrefetching: true,
  // No "x-powered-by: Next.js": nothing to gain from telling.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Browsers may still ask for /favicon.ico; answer with the icon made from the logo
  // (spec 8.1), rather than a 404.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icons/favicon-32.png" }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
