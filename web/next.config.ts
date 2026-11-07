import type { NextConfig } from "next";

// Static export: pages read NAV and vault state from NEAR RPC in the browser,
// and user calls (deposit, withdraw, signal) go wallet → contract / operator.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default config;
