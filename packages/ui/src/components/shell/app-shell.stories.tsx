import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { Button } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { expectTouchTarget, phone, tablet, wide } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { shellCopy, storyProjectTabs, storySidebar, storyTopBar } from "../../storybook/shell.tsx";
import { PageContent, TabsBar } from "./page-frame.tsx";
import { PageHeader } from "./page-header.tsx";
import { AppShell } from "./app-shell.tsx";

const copy = {
  exportList: { en: "Export", ar: "تصدير" },
  moreActions: { en: "More actions", ar: "إجراءات أخرى" },
};

function Page({ context, defaultCollapsed = false, long = false }: { context: StoryContext; defaultCollapsed?: boolean; long?: boolean }) {
  const t = (text: { en: string; ar: string }) => storyText(context, text);
  return (
    <AppShell
      sidebar={{ ...storySidebar(context), defaultCollapsed }}
      topBar={storyTopBar(context)}
      tabs={<TabsBar>{storyProjectTabs(context, "submittals", ["submittals", "inspections", "snag_list", "site_reports", "drawings"])}</TabsBar>}
      menuLabel={t(shellCopy.menu)}
      closeLabel={t(shellCopy.close)}
    >
      <PageContent>
        <PageHeader
          title={t(shellCopy.submittals)}
          primaryAction={
            <Button>
              <Icon name="plus" />
              {t(shellCopy.newSubmittal)}
            </Button>
          }
          actions={<Button variant="secondary">{t(copy.exportList)}</Button>}
          more={{ label: t(copy.moreActions), closeLabel: t(shellCopy.close) }}
        />
        {/* Tall enough to scroll the window, as a long List does. */}
        <div className={long ? "mt-4 h-[300vh] rounded-md border border-dashed border-border-strong" : "mt-4 h-64 rounded-md border border-dashed border-border-strong"} />
      </PageContent>
    </AppShell>
  );
}

const meta = {
  title: "Shell/AppShell",
  render: (_args, context) => <Page context={context} />,
  // Screenshotted as a whole screen, wider than a tablet: the sidebar shows from 1025 up.
  parameters: { ...overlay, ...wide, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const t = (context: PlayContext, text: { en: string; ar: string }) => storyText(context, text);
// The desktop sidebar; hidden up to the tablet width, where it can't be found by role.
const sidebar = (context: PlayContext) => context.canvasElement.querySelector<HTMLElement>("[data-sidebar]")!;
const home = (context: PlayContext) => within(sidebar(context)).getByRole("link", { name: t(context, shellCopy.home) });
const projectTabs = (context: PlayContext) => context.canvas.getByRole("navigation", { name: storyText(context, { en: "Project", ar: "المشروع" }) });
const memberButton = (context: PlayContext) => within(context.canvas.getByRole("banner")).getByRole("button", { name: t(context, shellCopy.person) });
// The page's content area: the padding round the page.
const content = (context: PlayContext) => context.canvas.getByRole("main").querySelector<HTMLElement>("[data-page-content]")!;
const paddingInline = (element: HTMLElement) => parseFloat(getComputedStyle(element).paddingInlineStart);

/** No sideways scroll: the page is never wider than the window. */
async function expectNoSidewaysScroll() {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** The menu button opens the drawer from the inline-start side: 304 wide (never over 85% of the window), the Member at its bottom. */
async function openDrawer(context: PlayContext) {
  const menu = context.canvas.getByRole("button", { name: t(context, shellCopy.menu) });
  await expectTouchTarget(menu);
  await userEvent.click(menu);
  const drawer = await screen.findByRole("dialog", { name: new RegExp(t(context, shellCopy.brand)) });
  const box = drawer.getBoundingClientRect();
  await expect(box.width).toBe(Math.min(304, Math.floor(innerWidth * 0.85)));
  if (storyLocale(context) === "ar") await expect(box.right).toBe(innerWidth);
  else await expect(box.left).toBe(0);
  // The Member block (avatar, name, Company) sits at the drawer's bottom, as at the desktop sidebar's foot.
  const member = within(drawer).getByRole("button", { name: new RegExp(t(context, shellCopy.person)) });
  await expect(member).toHaveTextContent(t(context, shellCopy.ownCompany));
  await expect(box.bottom - member.getBoundingClientRect().bottom).toBeLessThanOrEqual(24);
  return { menu, drawer };
}

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
    await expect(banner.getBoundingClientRect().height).toBe(72);
    // On a desktop the Member's name shows beside the avatar.
    await expect(within(memberButton(context)).getByText(t(context, shellCopy.person))).toBeVisible();
    await expect(banner).toHaveTextContent(t(context, shellCopy.project));
    await expect(banner).toHaveTextContent(t(context, shellCopy.hostCompany));
    await expect(within(banner).getByRole("link", { name: t(context, shellCopy.back) })).toBeVisible();
    await expect(sidebar(context)).toHaveTextContent(t(context, shellCopy.ownCompany));
    if (storyLocale(context) === "ar") await expect(aside.left).toBeGreaterThanOrEqual(main.right - 1);
    else await expect(aside.right).toBeLessThanOrEqual(main.left + 1);
    await expect(paddingInline(content(context))).toBe(28);

    const nav = context.canvas.getByRole("navigation", { name: t(context, shellCopy.nav) });
    await expect(nav.querySelector("[aria-current=page]")).toHaveTextContent(t(context, shellCopy.projects));
    await expect(context.canvas.getByRole("heading", { level: 1 })).toHaveTextContent(t(context, shellCopy.submittals));
    await expect(projectTabs(context).querySelector("[aria-current=page]")).toHaveTextContent(t(context, shellCopy.submittals));
    // The phone menu button is gone on a desktop; the primary action stays in the page header, with no bottom bar.
    await expect(context.canvas.queryByRole("button", { name: t(context, shellCopy.menu) })).toBeNull();
    await expect(context.canvas.getByRole("main").querySelector("[data-page-header]")).toContainElement(
      context.canvas.getByRole("button", { name: t(context, shellCopy.newSubmittal) }),
    );
    await expect(context.canvasElement.querySelector("[data-action-bar]")).toBeNull();
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
 * A tablet (RP-1272, drawn at 820): no sidebar up to and including 1024; the menu button opens it as a
 * drawer. The top bar is 72 high and shows the Member as the avatar only (the name is in the Member menu);
 * the back arrow and the Project's mark stay. The content has 16 at the sides. The bars stay put on scroll,
 * and the primary action stays in the page header. Left with the drawer open for the screenshot.
 */
export const Tablet: Story = {
  render: (_args, context) => <Page context={context} long />,
  parameters: { ...tablet, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    await expect(sidebar(context)).not.toBeVisible();
    const banner = context.canvas.getByRole("banner");
    await expect(banner.getBoundingClientRect().height).toBe(72);
    // The avatar only: the name is the button's name, not shown.
    await expect(memberButton(context).getBoundingClientRect().width).toBeLessThanOrEqual(44);
    await expect(within(banner).getByRole("link", { name: t(context, shellCopy.back) })).toBeVisible();
    await expect(banner.querySelector("[data-project-mark]")).toBeVisible();
    await expect(paddingInline(content(context))).toBe(16);
    await expect(projectTabs(context).querySelector("a")!.getBoundingClientRect().height).toBe(52);
    await expectNoSidewaysScroll();

    // The bars stay put on scroll at a tablet.
    window.scrollTo(0, 600);
    await waitFor(() => expect(scrollY).toBe(600));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(banner.getBoundingClientRect().top).toBe(0);
    window.scrollTo(0, 0);

    await expect(context.canvas.getByRole("main").querySelector("[data-page-header]")).toContainElement(
      context.canvas.getByRole("button", { name: t(context, shellCopy.newSubmittal) }),
    );
    await expect(context.canvasElement.querySelector("[data-action-bar]")).toBeNull();

    const { menu } = await openDrawer(context);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(menu).toHaveFocus();
    await userEvent.click(menu);
    await screen.findByRole("dialog");
  },
};

/**
 * A phone (RP-1272, drawn at 402): the top bar is 56 high, with the menu button, the back arrow (44 × 44),
 * the Project's name and Host Company (no mark), the bell and the avatar. The Project tabs scroll sideways
 * and snap per tab, fading at the end while more are hidden; they are 46 high. The drawer opens from the
 * inline-start side, with the Member at its bottom; choosing a page closes it. Left open for the screenshot.
 */
export const Phone: Story = {
  parameters: { ...phone, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    await expect(sidebar(context)).not.toBeVisible();
    const banner = context.canvas.getByRole("banner");
    await expect(banner.getBoundingClientRect().height).toBe(56);
    const back = within(banner).getByRole("link", { name: t(context, shellCopy.back) });
    await expect(back).toBeVisible();
    await expect(back.getBoundingClientRect().width).toBe(44);
    await expect(back.getBoundingClientRect().height).toBe(44);
    await expect(banner.querySelector("[data-project-mark]")).not.toBeVisible();
    // The avatar only: the name is the button's name, not shown.
    await expect(memberButton(context).getBoundingClientRect().width).toBeLessThanOrEqual(44);
    await expectTouchTarget(memberButton(context));
    await expect(paddingInline(content(context))).toBe(16);
    await expectNoSidewaysScroll();

    const tabs = projectTabs(context);
    const list = tabs.querySelector("ul")!;
    await expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    await expect(getComputedStyle(list).scrollSnapType).toMatch(/^x/);
    await expect(getComputedStyle(list.querySelector("li")!).scrollSnapAlign).toBe("start");
    await expect(tabs.querySelector("a")!.getBoundingClientRect().height).toBe(46);
    // A fade at the row's end while more tabs are hidden there: the right in English, the left in Arabic.
    const fade = await waitFor(() => tabs.querySelector<HTMLElement>("[data-fade]")!);
    const row = list.getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(fade.getBoundingClientRect().left).toBe(row.left);
    else await expect(fade.getBoundingClientRect().right).toBe(row.right);
    // Scrolled to the end, the fade goes.
    list.scrollBy({ left: storyLocale(context) === "ar" ? -list.scrollWidth : list.scrollWidth });
    await waitFor(() => expect(tabs.querySelector("[data-fade]")).toBeNull());
    list.scrollBy({ left: storyLocale(context) === "ar" ? list.scrollWidth : -list.scrollWidth });

    const { menu } = await openDrawer(context);
    await userEvent.click(screen.getByRole("link", { name: t(context, shellCopy.members) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(menu).toHaveFocus();

    await userEvent.click(menu);
    await screen.findByRole("dialog");
  },
};

/**
 * On a phone the top bar and the Project tabs hide as the page scrolls down and come back as it scrolls up,
 * so a long List has the screen (RP-1272, owner's choice 2026-11-09). Motion is reduced in the harness: they
 * move without a transition then.
 */
export const PhoneHidesBarsOnScroll: Story = {
  render: (_args, context) => <Page context={context} long />,
  parameters: { ...phone, layout: "fullscreen" },
  play: async (context) => {
    const banner = context.canvas.getByRole("banner");
    const tabs = projectTabs(context);
    await expect(getComputedStyle(banner.parentElement!).transitionProperty).toBe("none");

    window.scrollTo(0, 400);
    await waitFor(() => expect(banner.getBoundingClientRect().bottom).toBeLessThanOrEqual(0));
    await expect(tabs.getBoundingClientRect().bottom).toBeLessThanOrEqual(0);

    window.scrollTo(0, 300);
    await waitFor(() => expect(banner.getBoundingClientRect().top).toBe(0));
    await expect(tabs.getBoundingClientRect().top).toBe(56);

    // Keyboard focus moving into the bars brings them back too.
    window.scrollTo(0, 800);
    await waitFor(() => expect(banner.getBoundingClientRect().bottom).toBeLessThanOrEqual(0));
    within(banner).getByRole("link", { name: t(context, shellCopy.back) }).focus();
    await waitFor(() => expect(banner.getBoundingClientRect().top).toBe(0));
    window.scrollTo(0, 0);
  },
};

/**
 * On a phone the page's primary action moves to a bar stuck to the bottom of the screen, above Safari's
 * toolbar and padded by the safe-area inset; the page header keeps the other actions behind ⋯, which opens
 * them in a bottom sheet. Left open for the screenshot.
 */
export const PhoneActionBar: Story = {
  parameters: { ...phone, ...overlay, layout: "fullscreen" },
  play: async (context) => {
    const bar = context.canvasElement.querySelector<HTMLElement>("[data-action-bar]")!;
    const action = await waitFor(() => within(bar).getByRole("button", { name: t(context, shellCopy.newSubmittal) }));
    await expect(bar.getBoundingClientRect().bottom).toBe(innerHeight);
    await expect(bar.style.paddingBottom).toContain("safe-area-inset-bottom");
    // Full width inside the bar's 16 at each side.
    await expect(action.getBoundingClientRect().width).toBe(innerWidth - 32);
    await expect(context.canvas.getByRole("main").querySelector("[data-page-header]")).not.toContainElement(action);
    await expect(context.canvas.queryByRole("button", { name: t(context, copy.exportList) })).toBeNull();

    const more = context.canvas.getByRole("button", { name: t(context, copy.moreActions) });
    await expectTouchTarget(more);
    await userEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: t(context, copy.moreActions) });
    await expect(within(sheet).getByRole("button", { name: t(context, copy.exportList) })).toBeVisible();
    await expect(sheet.getBoundingClientRect().bottom).toBe(innerHeight);
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
