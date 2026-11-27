import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Next.js 16 defaults; both become mandatory in the next major version.
  cacheComponents: true,
  partialPrefetching: true,
  // Browsers may still ask for /favicon.ico; answer with the icon made from the logo
  // (spec 8.1), rather than a 404.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icons/favicon-32.png" }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
