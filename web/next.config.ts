import type { NextConfig } from "next";

// Static export: pages read NAV and vault state from NEAR RPC in the browser,
// and user calls (deposit, withdraw, signal) go wallet → contract / operator.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // GitHub Pages serves the site from /<repo>/ (set by .github/workflows/pages.yml).
  ...(process.env.NEXT_PUBLIC_BASE_PATH ? { basePath: process.env.NEXT_PUBLIC_BASE_PATH } : {}),
};
export default config;
