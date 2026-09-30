import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storyPageHeader, storySidebar, storyTopBar } from "../../storybook/shell.tsx";
import { AppShell } from "./app-shell.tsx";

function Page({ context, defaultCollapsed = false }: { context: StoryContext; defaultCollapsed?: boolean }) {
  return (
    <AppShell
      sidebar={{ ...storySidebar(context), defaultCollapsed }}
      topBar={storyTopBar(context)}
      menuLabel={storyText(context, shellCopy.menu)}
      closeLabel={storyText(context, shellCopy.close)}
    >
      {storyPageHeader(context)}
      <div className="p-6">
        <div className="h-64 rounded-md border border-dashed border-border-strong" />
      </div>
    </AppShell>
  );
}

const meta = {
  title: "Shell/AppShell",
  render: (_args, context) => <Page context={context} />,
  // Screenshotted as a whole screen.
  parameters: { ...overlay, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const t = (context: PlayContext, text: { en: string; ar: string }) => storyText(context, text);
// The desktop sidebar; hidden on a phone, where it can't be found by role.
const sidebar = (context: PlayContext) => context.canvasElement.querySelector<HTMLElement>("[data-sidebar]")!;

/**
 * Every page's layout. The sidebar sits on the inline-start side: the left in
 * English, the right in Arabic. The current page is marked in the sidebar and
 * the Project tabs.
 */
export const Desktop: Story = {
  play: async (context) => {
    const aside = sidebar(context).getBoundingClientRect();
    const main = context.canvas.getByRole("main").getBoundingClientRect();
    const person = context.canvas.getByRole("button", { name: t(context, shellCopy.person) });
    await expect(context.canvas.getByRole("banner")).toContainElement(person);
    if (storyLocale(context) === "ar") await expect(aside.left).toBeGreaterThanOrEqual(main.right - 1);
    else await expect(aside.right).toBeLessThanOrEqual(main.left + 1);

    const nav = context.canvas.getByRole("navigation", { name: t(context, shellCopy.nav) });
    await expect(nav.querySelector("[aria-current=page]")).toHaveTextContent(t(context, shellCopy.projects));
    await expect(context.canvas.getByRole("heading", { level: 1 })).toHaveTextContent(t(context, shellCopy.project));
    // The phone menu button is gone on a desktop.
    await expect(context.canvas.queryByRole("button", { name: t(context, shellCopy.menu) })).toBeNull();
  },
};

/**
 * The sidebar collapses to icons and expands again from the keyboard. Collapsed,
 * each link is still named after its page, and shows that name in a tooltip.
 */
export const CollapseByKeyboard: Story = {
  play: async (context) => {
    const collapse = context.canvas.getByRole("button", { name: t(context, shellCopy.collapse) });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    collapse.focus();
    await userEvent.keyboard("{Enter}");

    const expand = context.canvas.getByRole("button", { name: t(context, shellCopy.expand) });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(expand).toHaveFocus();
    await waitFor(() => expect(sidebar(context).getBoundingClientRect().width).toBe(64));

    await userEvent.tab();
    const home = context.canvas.getByRole("link", { name: t(context, shellCopy.home) });
    await expect(home).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    await expect(tooltip).toHaveTextContent(t(context, shellCopy.home));
    // It opens towards the page (the inline-end side): right of the link in English, left in Arabic.
    const tip = tooltip.closest("[data-side]")!.getBoundingClientRect();
    const link = home.getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(tip.right).toBeLessThanOrEqual(link.left);
    else await expect(tip.left).toBeGreaterThanOrEqual(link.right);
    // Named once: the tooltip repeats the name, so it isn't also the description.
    await expect(home).toHaveAccessibleDescription("");

    await userEvent.tab({ shift: true });
    await userEvent.keyboard(" ");
    await expect(context.canvas.getByRole("button", { name: t(context, shellCopy.collapse) })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(sidebar(context).getBoundingClientRect().width).toBe(240));
  },
};

/** Collapsed from a saved preference: icons only, the brand kept for screen readers. */
export const Collapsed: Story = {
  render: (_args, context) => <Page context={context} defaultCollapsed />,
  play: async (context) => {
    await expect(sidebar(context).getBoundingClientRect().width).toBe(64);
    for (const page of [shellCopy.home, shellCopy.projects, shellCopy.members, shellCopy.company]) {
      await expect(context.canvas.getByRole("link", { name: t(context, page) })).toBeVisible();
    }
  },
};

/**
 * On a phone the sidebar becomes a sheet from the inline-start side, opened by
 * the menu button in the top bar; choosing a page closes it. The Project tabs
 * scroll sideways. Left open for the screenshot.
 */
export const Phone: Story = {
  parameters: { ...phone, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    await expect(sidebar(context)).not.toBeVisible();
    const tabs = context.canvas.getByRole("navigation", { name: storyText(context, { en: "Project", ar: "المشروع" }) });
    const list = tabs.querySelector("ul")!;
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);

    const menu = context.canvas.getByRole("button", { name: t(context, shellCopy.menu) });
    await expectTouchTarget(menu);
    await expectTouchTarget(context.canvas.getByRole("button", { name: t(context, shellCopy.person) }));
    await userEvent.click(menu);
    const sheet = await screen.findByRole("dialog", { name: t(context, shellCopy.brand) });
    const box = sheet.getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(box.right).toBe(innerWidth);
    else await expect(box.left).toBe(0);

    await userEvent.click(screen.getByRole("link", { name: t(context, shellCopy.members) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(menu).toHaveFocus();

    await userEvent.click(menu);
    await screen.findByRole("dialog");
  },
};
