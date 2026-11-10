import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone, tablet, wide } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Badge } from "../data/badge.tsx";
import { SettingsHeader, SettingsLayout, SettingsNav, SettingsSection, type SettingsNavItem } from "./settings-layout.tsx";

// The template of the Project Settings pages (RP-412): the settings navigation
// beside the page (a select above it on a phone) and the page's section cards.
const meta = {
  title: "Settings/SettingsLayout",
  parameters: { layout: "fullscreen" },
} satisfies Meta<{ onNavigate?: (href: string) => void }>;

export default meta;
type Story = StoryObj<{ onNavigate?: (href: string) => void }>;

const copy = {
  heading: { en: "Project settings", ar: "إعدادات المشروع" },
  numbering: { en: "Document Numbering", ar: "ترقيم المستندات" },
  trades: { en: "Trades & Locations", ar: "التخصصات والمواقع" },
  visibility: { en: "Visibility", ar: "الرؤية" },
  title: { en: "Document Numbering", ar: "ترقيم المستندات" },
  description: {
    en: "How this Project builds its Document Numbers.",
    ar: "كيف يبني هذا المشروع أرقام مستنداته.",
  },
  readOnly: { en: "Only Project Admins can change this", ar: "يمكن لمديري المشروع فقط تغيير هذا" },
  pattern: { en: "Project pattern", ar: "نمط المشروع" },
  patternHint: { en: "Applies to every Work Item Type without its own.", ar: "ينطبق على كل نوع عمل بلا نمط خاص." },
  overrides: { en: "Overrides per Work Item Type", ar: "الاستثناءات لكل نوع عمل" },
  count: { en: "4 of 6", ar: "4 من 6" },
};

const items = (context: { globals: Record<string, unknown> }): SettingsNavItem[] => [
  { key: "numbering", label: storyText(context, copy.numbering), icon: "list", href: "#/numbering" },
  { key: "trades-locations", label: storyText(context, copy.trades), icon: "map-pin", href: "#/trades-locations" },
  { key: "visibility", label: storyText(context, copy.visibility), icon: "eye", href: "#/visibility" },
];

// The app's twelve pages (ProjectSettingsNav), for a row longer than a tablet is wide.
const many = {
  workflows: { en: "Workflows", ar: "مسارات العمل" },
  bulk: { en: "Bulk Imports", ar: "الاستيراد المجمّع" },
  screens: { en: "Screens", ar: "الشاشات" },
  stages: { en: "Stages", ar: "المراحل" },
  outcomes: { en: "Outcomes", ar: "النتائج" },
  suppliers: { en: "Approved Supplier List", ar: "قائمة الموردين المعتمدين" },
  modules: { en: "Modules", ar: "الوحدات" },
  links: { en: "Required links", ar: "الروابط المطلوبة" },
  checklists: { en: "Checklist Templates", ar: "قوالب قوائم التحقق" },
  record: { en: "Documental Record", ar: "السجل التوثيقي" },
};
const allItems = (context: { globals: Record<string, unknown> }): SettingsNavItem[] => {
  const [numbering, trades, visibility] = items(context);
  const item = (key: keyof typeof many, icon: SettingsNavItem["icon"]): SettingsNavItem => ({ key, label: storyText(context, many[key]), icon, href: `#/${key}` });
  return [
    numbering!,
    item("workflows", "refresh"),
    item("bulk", "upload"),
    item("screens", "template"),
    item("stages", "flag"),
    item("outcomes", "circle-check"),
    trades!,
    item("suppliers", "building"),
    item("modules", "layout-grid"),
    item("links", "link"),
    item("checklists", "clipboard-check"),
    item("record", "file-text"),
    visibility!,
  ];
};

function Page({
  context,
  readOnly = false,
  onNavigate,
  navItems = items(context),
  current = "numbering",
}: {
  context: { globals: Record<string, unknown> };
  readOnly?: boolean;
  onNavigate?: (href: string) => void;
  navItems?: SettingsNavItem[];
  current?: string;
}) {
  return (
    <div className="bg-canvas p-4 sm:p-7">
      <SettingsLayout
        nav={<SettingsNav heading={storyText(context, copy.heading)} items={navItems} current={current} onNavigate={onNavigate ?? fn()} />}
      >
        <SettingsHeader
          title={storyText(context, copy.title)}
          description={storyText(context, copy.description)}
          readOnlyLabel={readOnly ? storyText(context, copy.readOnly) : undefined}
        />
        <SettingsSection
          title={storyText(context, copy.pattern)}
          description={storyText(context, copy.patternHint)}
          actions={<Badge tone="neutral">{storyText(context, copy.count)}</Badge>}
        >
          <div className="h-24 rounded-md border border-dashed border-border-strong" />
        </SettingsSection>
        <SettingsSection title={storyText(context, copy.overrides)}>
          <div className="h-16 rounded-md border border-dashed border-border-strong" />
        </SettingsSection>
      </SettingsLayout>
    </div>
  );
}

/** The page lays out within the window: nothing scrolls the page sideways. */
async function expectNoSidewaysScroll() {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}

/** Wider than a tablet: the navigation on the inline-start side (the right in Arabic), the current page marked, and the cards beside it. */
export const Default: Story = {
  parameters: { ...wide, layout: "fullscreen" },
  render: (_args, context) => <Page context={context} />,
  play: async (context) => {
    const nav = context.canvas.getByRole("navigation", { name: storyText(context, copy.heading) });
    await expect(within(nav).getByRole("link", { name: storyText(context, copy.numbering) })).toHaveAttribute("aria-current", "page");
    await expect(within(nav).getAllByRole("link")).toHaveLength(3);
    await expect(context.canvas.getByRole("heading", { level: 1, name: storyText(context, copy.title) })).toBeVisible();
    await expect(context.canvas.getByRole("heading", { level: 2, name: storyText(context, copy.pattern) })).toBeVisible();
    // The navigation is before the page on the inline-start side.
    const dir = storyLocale(context) === "ar" ? -1 : 1;
    const navBox = nav.getBoundingClientRect();
    const pageBox = context.canvas.getByRole("heading", { level: 1 }).getBoundingClientRect();
    await expect(Math.sign(pageBox.left - navBox.left)).toBe(dir);
  },
};

/** Whoever may read the page but not change it sees a note in the header. */
export const ReadOnly: Story = {
  render: (_args, context) => <Page context={context} readOnly />,
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.readOnly))).toBeVisible();
  },
};

/** On a phone the navigation is a select above the page; choosing a page navigates. */
export const Phone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  args: { onNavigate: fn() },
  render: (args, context) => <Page context={context} onNavigate={args.onNavigate} />,
  play: async (context) => {
    await expect(context.canvas.queryByRole("navigation", { name: storyText(context, copy.heading) })).toBeNull();
    const select = context.canvas.getByRole("combobox", { name: storyText(context, copy.heading) });
    await expect(select).toHaveDisplayValue(storyText(context, copy.numbering));
    await userEvent.selectOptions(select, "#/trades-locations");
    await expect(context.args.onNavigate).toHaveBeenCalledWith("#/trades-locations");
    await expectNoSidewaysScroll();
  },
};

/**
 * On a tablet (RP-1275, gap-table row 55) the navigation is a row of chips above the page, scrolling sideways
 * (from the right in Arabic) with the open page's chip in view; each chip a 44px touch target (row 58).
 */
export const Tablet: Story = {
  parameters: { ...tablet, layout: "fullscreen" },
  render: (_args, context) => <Page context={context} navItems={allItems(context)} current="record" />,
  play: async (context) => {
    const nav = context.canvas.getByRole("navigation", { name: storyText(context, copy.heading) });
    await expect(context.canvas.queryByRole("combobox", { name: storyText(context, copy.heading) })).toBeNull();
    const links = within(nav).getAllByRole("link");
    await expect(links).toHaveLength(13);
    // One row, above the page.
    const tops = new Set(links.map((link) => Math.round(link.getBoundingClientRect().top)));
    await expect(tops.size).toBe(1);
    const title = context.canvas.getByRole("heading", { level: 1, name: storyText(context, copy.title) });
    await expect(nav.getBoundingClientRect().bottom).toBeLessThanOrEqual(title.getBoundingClientRect().top);
    // In the locale's reading order: the second chip after the first, to the left in Arabic.
    const dir = storyLocale(context) === "ar" ? -1 : 1;
    await expect(Math.sign(links[1]!.getBoundingClientRect().left - links[0]!.getBoundingClientRect().left)).toBe(dir);
    // The row is longer than the window and scrolls; the open page's chip is in view.
    const scroller = links[0]!.closest("ul")!;
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const current = within(nav).getByRole("link", { name: storyText(context, many.record) });
    await expect(current).toHaveAttribute("aria-current", "page");
    const row = scroller.getBoundingClientRect();
    const chip = current.getBoundingClientRect();
    await expect(chip.left).toBeGreaterThanOrEqual(row.left);
    await expect(chip.right).toBeLessThanOrEqual(row.right);
    for (const link of links) await expectTouchTarget(link);
    await expectNoSidewaysScroll();
  },
};
