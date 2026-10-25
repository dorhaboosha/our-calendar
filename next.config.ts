import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 defaults; both become mandatory in the next major version.
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
