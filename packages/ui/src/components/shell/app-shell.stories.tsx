import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storyProjectTabs, storySidebar, storyTopBar } from "../../storybook/shell.tsx";
import { PageContent, TabsBar } from "./page-frame.tsx";
import { AppShell } from "./app-shell.tsx";

function Page({ context, defaultCollapsed = false }: { context: StoryContext; defaultCollapsed?: boolean }) {
  return (
    <AppShell
      sidebar={{ ...storySidebar(context), defaultCollapsed }}
      topBar={storyTopBar(context)}
      menuLabel={storyText(context, shellCopy.menu)}
      closeLabel={storyText(context, shellCopy.close)}
    >
      <TabsBar>{storyProjectTabs(context, "submittals", ["submittals", "inspections", "drawings"])}</TabsBar>
      <PageContent>
        <h1 className="mb-4 font-display text-h4 font-bold">{storyText(context, shellCopy.submittals)}</h1>
        <div className="h-64 rounded-md border border-dashed border-border-strong" />
      </PageContent>
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
const home = (context: PlayContext) => within(sidebar(context)).getByRole("link", { name: t(context, shellCopy.home) });

/**
 * Every signed-in page's layout (RP-406), here inside a Project. The sidebar
 * sits on the inline-start side: the left in English, the right in Arabic, with
 * the brand and the Member's Company at the top and the Member at the bottom.
 * The top bar names the Project and its Host Company; the current page is
 * marked in the sidebar and the Project tabs.
 */
export const Desktop: Story = {
  play: async (context) => {
    const aside = sidebar(context).getBoundingClientRect();
    const main = context.canvas.getByRole("main").getBoundingClientRect();
    await expect(aside.width).toBe(264);
    const banner = context.canvas.getByRole("banner");
    await expect(within(banner).getByRole("button", { name: t(context, shellCopy.person) })).toBeVisible();
    await expect(banner).toHaveTextContent(t(context, shellCopy.project));
    await expect(banner).toHaveTextContent(t(context, shellCopy.hostCompany));
    await expect(within(banner).getByRole("link", { name: t(context, shellCopy.back) })).toBeVisible();
    await expect(sidebar(context)).toHaveTextContent(t(context, shellCopy.ownCompany));
    if (storyLocale(context) === "ar") await expect(aside.left).toBeGreaterThanOrEqual(main.right - 1);
    else await expect(aside.right).toBeLessThanOrEqual(main.left + 1);

    const nav = context.canvas.getByRole("navigation", { name: t(context, shellCopy.nav) });
    await expect(nav.querySelector("[aria-current=page]")).toHaveTextContent(t(context, shellCopy.projects));
    await expect(context.canvas.getByRole("heading", { level: 1 })).toHaveTextContent(t(context, shellCopy.submittals));
    const tabs = context.canvas.getByRole("navigation", { name: storyText(context, { en: "Project", ar: "المشروع" }) });
    await expect(tabs.querySelector("[aria-current=page]")).toHaveTextContent(t(context, shellCopy.submittals));
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
    await waitFor(() => expect(sidebar(context).getBoundingClientRect().width).toBe(72));

      const homeLink = home(context);
    homeLink.focus();
    await expect(homeLink).toHaveFocus();
    const tooltip = await screen.findByRole("tooltip");
    await expect(tooltip).toHaveTextContent(t(context, shellCopy.home));
    // It opens towards the page (the inline-end side): right of the link in English, left in Arabic.
    const tip = tooltip.closest("[data-side]")!.getBoundingClientRect();
    const link = homeLink.getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(tip.right).toBeLessThanOrEqual(link.left);
    else await expect(tip.left).toBeGreaterThanOrEqual(link.right);
    // Named once: the tooltip repeats the name, so it isn't also the description.
    await expect(homeLink).toHaveAccessibleDescription("");

    context.canvas.getByRole("button", { name: t(context, shellCopy.expand) }).focus();
    await userEvent.keyboard(" ");
    await expect(context.canvas.getByRole("button", { name: t(context, shellCopy.collapse) })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(sidebar(context).getBoundingClientRect().width).toBe(264));
  },
};

/** Collapsed from a saved preference: an icon rail with the logo, each page and the Member's avatar. */
export const Collapsed: Story = {
  render: (_args, context) => <Page context={context} defaultCollapsed />,
  play: async (context) => {
    await expect(sidebar(context).getBoundingClientRect().width).toBe(72);
    for (const page of [shellCopy.home, shellCopy.projects, shellCopy.members, shellCopy.companyProjects]) {
      await expect(within(sidebar(context)).getByRole("link", { name: t(context, page) })).toBeVisible();
    }
    // The Member stays at the bottom as an avatar, still named after them.
    await expect(within(sidebar(context)).getByRole("button", { name: t(context, shellCopy.person) })).toBeVisible();
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
    const sheet = await screen.findByRole("dialog", { name: new RegExp(t(context, shellCopy.brand)) });
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

/**
 * The signed-in Member at the bottom of the sidebar, with their Company, opens
 * the same menu as the top bar's avatar: the language switch and the extra
 * items (Sign out), opening upwards. Left open for the screenshot.
 */
export const MemberAtTheBottom: Story = {
  play: async (context) => {
    const card = within(sidebar(context)).getByRole("button", { name: new RegExp(t(context, shellCopy.person)) });
    await expect(card).toHaveTextContent(t(context, shellCopy.ownCompany));
    await userEvent.click(card);
    const menu = await screen.findByRole("dialog", { name: t(context, shellCopy.profile) });
    await expect(within(menu).getByRole("group", { name: t(context, shellCopy.language) })).toBeVisible();
    await expect(within(menu).getByRole("button", { name: t(context, shellCopy.signOut) })).toBeVisible();
    await expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(card.getBoundingClientRect().top);
  },
};
