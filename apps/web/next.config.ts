import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { prepareArabicFont } from "@rabaed/ui/fonts";

// Arabic in Thmanyah Sans when its private files are present at build time
// (supplied by CI, RP-211), otherwise IBM Plex Sans Arabic. Fonts are self-hosted.
prepareArabicFont();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  transpilePackages: ["@rabaed/domain", "@rabaed/ui"],
  // Dev only: each worktree is opened at laneN.localhost:<port> (see README), which Next
  // treats as a different origin from plain localhost.
  allowedDevOrigins: ["*.localhost"],
};

export default withNextIntl(config);
