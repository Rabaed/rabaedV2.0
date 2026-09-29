import { directionOf, type Locale } from "@rabaed/domain";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, screen, userEvent } from "storybook/test";
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
