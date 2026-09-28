import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { prepareArabicFont } from "../src/fonts/arabic-font.ts";

// Thmanyah Sans for Arabic when its private files are present, else IBM Plex Sans Arabic.
prepareArabicFont();

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  viteFinal: async (viteConfig) => ({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), tailwindcss()],
  }),
};

export default config;
