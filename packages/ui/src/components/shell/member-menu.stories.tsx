import { defaultAppearance, directionOf, type Appearance, type Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useState } from "react";
import { expect, screen, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storyMemberMenu } from "../../storybook/shell.tsx";
import { DirectionProvider } from "../form/direction.tsx";

const greeting = { en: "Good morning, Faisal", ar: "صباح الخير يا فيصل" };

/** A page whose language follows the switch, as the app's does. */
function LanguageDemo({ context }: { context: StoryContext }) {
  const [locale, setLocale] = useState<Locale>(storyLocale(context));
  const dir = directionOf(locale);
  return (
    <DirectionProvider dir={dir}>
      <div data-testid="page" lang={locale} dir={dir} className="flex items-center justify-between gap-4">
        <p className="text-body">{greeting[locale]}</p>
        {storyMemberMenu({ globals: { locale } }, { locale, onLocaleChange: setLocale })}
      </div>
    </DirectionProvider>
  );
}

const meta = {
  title: "Shell/MemberMenu",
  render: (_args, context) => <LanguageDemo context={context} />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The avatar and name open the Member's menu. Its language switch names each
 * language in itself and marks the current one pressed; choosing the other
 * switches the page between English (LTR) and Arabic (RTL). Left open for the
 * screenshot, in the story's own language.
 */
export const LanguageSwitch: Story = {
  parameters: overlay,
  play: async (context) => {
    const start = storyLocale(context);
    const other: Locale = start === "en" ? "ar" : "en";
    const page = context.canvas.getByTestId("page");

    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, shellCopy.person) }));
    const menu = await screen.findByRole("dialog", { name: storyText(context, shellCopy.profile) });
    const group = screen.getByRole("group", { name: storyText(context, shellCopy.language) });
    await expect(menu).toContainElement(group);
    const [english, arabic] = [screen.getByRole("button", { name: "English" }), screen.getByRole("button", { name: "العربية" })];
    await expect(arabic).toHaveAttribute("lang", "ar");
    await expect(start === "en" ? english : arabic).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(other === "en" ? english : arabic);
    await expect(page).toHaveAttribute("dir", directionOf(other));
    await expect(page).toHaveTextContent(greeting[other]);

    // And back, for the screenshot.
    await userEvent.click(screen.getByRole("button", { name: start === "en" ? "English" : "العربية" }));
    await expect(page).toHaveAttribute("dir", directionOf(start));
    await expect(screen.getByRole("button", { name: start === "en" ? "English" : "العربية" })).toHaveAttribute("aria-pressed", "true");
  },
};

const appearanceCopy = {
  theme: { en: "Theme", ar: "السمة" },
  mode: { en: "Mode", ar: "الوضع" },
  grey: { en: "Grey", ar: "رمادي" },
  warm: { en: "Warm", ar: "دافئ" },
  light: { en: "Light", ar: "فاتح" },
  dark: { en: "Dark", ar: "داكن" },
  system: { en: "System", ar: "النظام" },
};

/** A page painted in the Member's Theme and Mode, as the app's <html> is, repainted as they choose. */
function AppearanceDemo({ context }: { context: StoryContext }) {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance.theme;
    document.documentElement.dataset.mode = appearance.mode;
  }, [appearance]);
  return (
    <div data-testid="page" className="flex items-center justify-between gap-4">
      <p className="text-body">{t(greeting)}</p>
      {storyMemberMenu(context, {
        appearance: {
          value: appearance,
          onChange: setAppearance,
          labels: {
            theme: t(appearanceCopy.theme),
            mode: t(appearanceCopy.mode),
            themes: { grey: t(appearanceCopy.grey), warm: t(appearanceCopy.warm) },
            modes: { light: t(appearanceCopy.light), dark: t(appearanceCopy.dark), system: t(appearanceCopy.system) },
          },
        },
      })}
    </div>
  );
}

/**
 * Theme and Mode (owner decision 2026-10-11), under the language: Grey or Warm, and Light, Dark
 * or System. A new Member has Warm and System; choosing repaints the page at once. Left open in
 * Warm, Dark for the screenshot.
 */
export const ThemeAndMode: Story = {
  parameters: overlay,
  render: (_args, context) => <AppearanceDemo context={context} />,
  play: async (context) => {
    const t = (text: { en: string; ar: string }) => storyText(context, text);
    await userEvent.click(context.canvas.getByRole("button", { name: t(shellCopy.person) }));
    const menu = await screen.findByRole("dialog", { name: t(shellCopy.profile) });
    const theme = within(menu).getByRole("group", { name: t(appearanceCopy.theme) });
    const mode = within(menu).getByRole("group", { name: t(appearanceCopy.mode) });
    await expect(within(theme).getByRole("button", { name: t(appearanceCopy.warm) })).toHaveAttribute("aria-pressed", "true");
    await expect(within(mode).getByRole("button", { name: t(appearanceCopy.system) })).toHaveAttribute("aria-pressed", "true");
    const page = () => getComputedStyle(document.body).backgroundColor;
    const warmLight = page();

    await userEvent.click(within(theme).getByRole("button", { name: t(appearanceCopy.grey) }));
    await expect(document.documentElement).toHaveAttribute("data-theme", "grey");
    await userEvent.click(within(mode).getByRole("button", { name: t(appearanceCopy.dark) }));
    await expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    await expect(within(mode).getByRole("button", { name: t(appearanceCopy.dark) })).toHaveAttribute("aria-pressed", "true");
    const greyDark = page();
    await expect(greyDark).not.toBe(warmLight);

    await userEvent.click(within(theme).getByRole("button", { name: t(appearanceCopy.warm) }));
    await expect(document.documentElement).toHaveAttribute("data-theme", "warm");
    // The page itself repaints: espresso, neither navy nor the warm light canvas.
    await expect([warmLight, greyDark]).not.toContain(page());
  },
};
