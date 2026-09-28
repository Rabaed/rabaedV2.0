import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { prepareArabicFont } from "./src/fonts/arabic-font.ts";

prepareArabicFont();

// The story test harness: every Storybook story, in English and Arabic, in a
// real Chromium. See test/stories.test.tsx.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    name: "stories",
    include: ["test/**/*.test.tsx"],
    // Screenshot baselines are rendered on Linux (CI and the update-screenshots
    // workflow). Font rendering differs per OS, so other platforms skip the
    // comparison and still run the behaviour and accessibility checks.
    provide: { compareScreenshots: process.platform === "linux" },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      viewport: { width: 1024, height: 2400 },
    },
  },
});
