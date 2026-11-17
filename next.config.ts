import type { NextConfig } from "next";
import { toNextRedirects } from "./config/legacy-redirects";

// The Playwright fixture pages under app/e2e are named `page.e2e.tsx`. They are routes only when E2E_THEME_CHECK=1
// (playwright.config.ts sets it for its server, including its production build), so a normal build ships none of them.
const e2e = process.env.E2E_THEME_CHECK === "1";

const nextConfig: NextConfig = {
  pageExtensions: ["tsx", "ts", "jsx", "js", ...(e2e ? ["e2e.tsx"] : [])],
  // Old CompSocrates URLs keep working (docs/ROUTES.md). The table lives in config/legacy-redirects.ts.
  async redirects() {
    return toNextRedirects();
  },
};

export default nextConfig;
