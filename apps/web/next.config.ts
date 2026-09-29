import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";
import { prepareArabicFont } from "@rabaed/ui/fonts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  transpilePackages: ["@rabaed/domain", "@rabaed/ui"],
  // Dev only: each worktree is opened at laneN.localhost:<port> (see README), which Next
  // treats as a different origin from plain localhost.
  allowedDevOrigins: ["*.localhost"],
};

export default function nextConfig(phase: string): NextConfig {
  // Arabic in Thmanyah Sans when its private files are present at build time
  // (the deploy supplies them, RP-211), otherwise IBM Plex Sans Arabic. Fonts
  // are self-hosted. Only when building or in dev: `next start` runs from the
  // built image, whose files the server may not write (Dockerfile).
  if (phase !== PHASE_PRODUCTION_SERVER) prepareArabicFont();
  return withNextIntl(config);
}
