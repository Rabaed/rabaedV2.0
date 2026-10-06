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
    // Bidi isolates and marks are invisible in review: write them as \u escapes (RP-329). Autofixable.
    files: jsTsFiles,
    plugins: { rabaed },
    rules: { "rabaed/no-raw-bidi": "error" },
  },
  {
    // An ARN or account id in an error or log line reaches CloudWatch and the user (RP-329).
    files: ["apps/**/*.{ts,tsx,js}", "packages/**/*.{ts,tsx,js}", "scripts/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}", "**/test/**", "**/test-support/**"],
    plugins: { rabaed },
    rules: { "rabaed/no-aws-ids-in-errors": "error" },
  },
  {
    // Dates and numbers go through the domain's locale helpers, which keep Latin digits in Arabic (RP-330).
    files: ["apps/**/*.{ts,tsx,js}", "packages/**/*.{ts,tsx,js}", "scripts/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}", "**/test/**", "**/test-support/**", "packages/domain/src/locale.ts"],
    plugins: { rabaed },
    rules: { "rabaed/locale-through-helpers": "error" },
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
    // Glossary Avoid terms (RP-327) in names (strict but for established code names) and in copy (strict but for
    // narrow phrases); both lists, and why each entry is there, are in packages/eslint-plugin/src/avoid-rules.ts.
    files: ["apps/**/*.{ts,tsx,js}", "packages/**/*.{ts,tsx,js}", "scripts/**/*.ts"],
    ignores: [
      "**/*.test.{ts,tsx}", // tests quote the terms they check, and SQL roles and fixtures by their own names
      "**/test/**",
      "**/test-support/**",
      "**/*.stories.tsx", // mock construction data (concrete grades, electrical panels); the copy they show is the component's, which is checked
      "packages/ui/src/storybook/**", // the stories' mock shell (its Files and Schedule tabs are Module names) and harness
      "packages/infra/**", // AWS's own vocabulary: account, region, environment, subscriber
      "packages/eslint-plugin/**", // it names the terms it bans
      "packages/ui/src/components/icon/icon.tsx", // Tabler's icon names: user, users
      "packages/ui/src/tokens/scales.ts", // the `notes` step of the type scale
    ],
    plugins: { rabaed },
    rules: { "rabaed/no-avoid-terms": "error" },
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
    rules: { "rabaed/json-no-deadline-words": "error", "rabaed/json-no-avoid-terms": "error", "rabaed/json-no-raw-bidi": "error" },
  },
);
