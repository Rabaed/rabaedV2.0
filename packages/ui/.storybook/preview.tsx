import { directionOf } from "@rabaed/domain";
import type { Decorator, Preview } from "@storybook/react-vite";
import { DirectionProvider } from "../src/components/form/direction.tsx";
import { storyLocale } from "../src/storybook/locale.ts";
import { paintTheme, storyThemes } from "../src/storybook/theme.ts";
import type { ThemeName } from "../src/tokens/themes.ts";
import "./preview.css";

// Every story renders in the locale picked in the toolbar: English (LTR) or Arabic (RTL).
const withLocale: Decorator = (Story, context) => {
  const locale = storyLocale(context);
  const dir = directionOf(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  return (
    <DirectionProvider dir={dir}>
      <div lang={locale} dir={dir}>
        <Story />
      </div>
    </DirectionProvider>
  );
};

// A story's theme (`parameters.theme`, see src/storybook/theme.ts), else the toolbar's, on <html>
// as the app's server puts it; none is Grey, Light.
const withTheme: Decorator = (Story, context) => {
  const chosen = (context.parameters.theme ?? context.globals.theme) as ThemeName | "none" | undefined;
  paintTheme(chosen === "none" ? undefined : chosen);
  return <Story />;
};

const preview: Preview = {
  decorators: [withLocale, withTheme],
  globalTypes: {
    theme: {
      description: "Theme and Mode",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "none", title: "None (Grey, Light)" },
          ...storyThemes.map((theme) => ({ value: theme, title: theme })),
        ],
        dynamicTitle: true,
      },
    },
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
  initialGlobals: { locale: "en", theme: "none" },
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
