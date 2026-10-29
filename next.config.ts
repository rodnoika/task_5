import type { NextConfig } from "next";
const backend = (process.env.FASTAPI_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
export default config;
