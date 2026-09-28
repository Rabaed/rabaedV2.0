import { directionOf } from "@rabaed/domain";
import type { Decorator, Preview } from "@storybook/react-vite";
import { storyLocale } from "../src/storybook/locale.ts";
import "./preview.css";

// Every story renders in the locale picked in the toolbar: English (LTR) or Arabic (RTL).
const withLocale: Decorator = (Story, context) => {
  const locale = storyLocale(context);
  const dir = directionOf(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  return (
    <div lang={locale} dir={dir}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withLocale],
  globalTypes: {
    locale: {
      description: "Language and direction",
      toolbar: {
        title: "Language",
        icon: "globe",
        items: [
          { value: "en", title: "English (LTR)", right: "EN" },
          { value: "ar", title: "العربية (RTL)", right: "AR" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: "en" },
  parameters: {
    layout: "padded",
    a11y: {
      // WCAG 2.2 AA. The story test harness runs the same rules and fails on any violation.
      options: { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } },
      test: "error",
    },
  },
};

export default preview;
