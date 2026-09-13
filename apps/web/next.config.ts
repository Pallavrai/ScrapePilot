import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@scrapepilot/contracts", "@scrapepilot/ui"],
  serverExternalPackages: [
    "postgres",
    "playwright",
    "bullmq",
    "ioredis",
    "esbuild",
  ],
  outputFileTracingIncludes: {
    "/api/v1/*": [
      "../../packages/scraper-engine/src/**/*",
      "../../packages/contracts/src/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
