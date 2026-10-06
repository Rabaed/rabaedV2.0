import css from "@eslint/css";
import js from "@eslint/js";
import json from "@eslint/json";
import nextPlugin from "@next/eslint-plugin-next";
import rabaed from "@rabaed/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

const jsTsFiles = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];
const forJsTs = (config) => ({ ...config, files: config.files ?? jsTsFiles });

// Design guard rails (packages/ui/README.md, "Lint guard rails") apply to the UI code.
const uiCode = ["packages/ui/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"];
// Where raw colour values are allowed to live: the token sources and their tests.
const tokenSources = ["packages/ui/src/tokens/palette.ts", "packages/ui/src/tokens/scales.ts", "packages/ui/src/tokens/*.test.ts"];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**", "**/next-env.d.ts", "**/storybook-static/**", "**/cdk.out/**", "prototypes/**", "design/**"],
  },
  forJsTs(js.configs.recommended),
  ...tseslint.configs.recommended.map(forJsTs),
  {
    files: jsTsFiles,
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Rabaed Admin's page script runs in the browser, without a build step.
    files: ["apps/admin/src/pages/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    plugins: { rabaed },
    rules: { "rabaed/no-deadline-words": "error" },
  },
  {
    // Logs are kept by CloudWatch and must hold no customer content (RP-238, RP-287).
    files: ["apps/api/**/*.ts", "apps/worker/**/*.ts", "apps/admin/**/*.{ts,js}"],
    plugins: { rabaed },
    rules: { "rabaed/no-raw-error-logging": "error" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    files: uiCode,
    ignores: tokenSources,
    plugins: { rabaed },
    rules: {
      "rabaed/no-hardcoded-colour": "error",
      "rabaed/no-physical-direction": "error",
    },
  },
  {
    files: uiCode,
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { rabaed },
    rules: { "rabaed/no-deadline-words": "error" },
  },
  {
    // Only `next build` checks for "use client" (RP-362). Stories and the Storybook shell never run as Server Components.
    files: ["packages/ui/src/**/*.tsx", "apps/web/src/**/*.tsx"],
    ignores: ["**/*.stories.tsx", "**/*.test.tsx", "packages/ui/src/storybook/**"],
    plugins: { rabaed },
    rules: { "rabaed/use-client-directive": "error" },
  },
  {
    // The package has no translations of its own (packages/ui/README.md). Stories may word their own examples.
    files: ["packages/ui/src/components/**/*.{ts,tsx}"],
    ignores: ["**/*.stories.tsx"],
    plugins: { rabaed },
    rules: { "rabaed/no-ui-translations": "error" },
  },
  {
    files: ["packages/ui/**/*.css", "apps/web/**/*.css"],
    // The generated token file is where the palette's raw colours live.
    ignores: ["packages/ui/src/styles/tokens.css"],
    plugins: { css, rabaed },
    language: "css/css",
    languageOptions: { tolerant: true },
    rules: {
      "rabaed/css-no-hardcoded-colour": "error",
      "rabaed/css-no-physical-direction": "error",
    },
  },
  {
    files: ["apps/web/messages/*.json"],
    plugins: { json, rabaed },
    language: "json/json",
    rules: { "rabaed/json-no-deadline-words": "error" },
  },
);
