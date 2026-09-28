import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  transpilePackages: ["@rabaed/domain"],
  // Dev only: each worktree is opened at laneN.localhost:<port> (see README), which Next
  // treats as a different origin from plain localhost.
  allowedDevOrigins: ["*.localhost"],
};

export default withNextIntl(config);
