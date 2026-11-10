import type { NextConfig } from "next";
import { toNextRedirects } from "./config/legacy-redirects";

const nextConfig: NextConfig = {
  // Old CompSocrates URLs keep working (docs/ROUTES.md). The table lives in config/legacy-redirects.ts.
  async redirects() {
    return toNextRedirects();
  },
};

export default nextConfig;
