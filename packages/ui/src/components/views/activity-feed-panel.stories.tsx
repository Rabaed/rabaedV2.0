import type { ActivityFeedEntry } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { activityFeedPanelLabels } from "../../storybook/views.ts";
import { ActivityFeedPanel } from "./activity-feed-panel.tsx";

// The Activity Feed panel (RP-353, spec RP-344, design §5): "<Company> <did
// what> <Document Number> · Subject", newest first, people named only for the
// viewer's own Company. Story data only, as a Contractor sees its Project.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  title: b("Activity Feed", "النشاط"),
  module: b("Module", "الوحدة"),
  type: b("Type", "النوع"),
  mine: b("Only items I'm on", "العناصر التي أشارك فيها فقط"),
  viewAll: b("View all", "عرض الكل"),
  loadMore: b("Load more", "تحميل المزيد"),
  empty: b("Nothing has happened on the items you can see yet.", "لم يحدث شيء بعد على العناصر التي يمكنك رؤيتها."),
  internal: b("Only your Company sees this", "لا يراه إلا شركتك"),
};

const c1 = b("Al Bina Contracting", "البناء للمقاولات");
const k1 = b("Design Consultants", "المصممون الاستشاريون");
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const sar = { code: "SAR", name: b("Shop Drawing Submittal", "اعتماد مخططات تنفيذية") };
const id = (n: number) => `0192e0a0-0000-7000-8000-${String(n).padStart(12, "0")}`;

const entry = (n: number, over: Partial<ActivityFeedEntry> & { minutesAgo: number }): ActivityFeedEntry => {
  const { minutesAgo, ...rest } = over;
  return {
    id: id(100 + n),
    type: "transition",
    at: new Date(Date.UTC(2026, 9, 6, 9, 0) - minutesAgo * 60_000).toISOString(),
    audience: "shared",
    by: { companyName: c1, memberName: null },
    transition: b("Submit", "تقديم"),
    outcome: null,
    workItem: { id: id(n), documentNumber: `TWR-C1-EL-MAR-000${n}`, title: "Cable tray, galvanised 300 mm", type: mar },
    ...rest,
  };
};

const entries: ActivityFeedEntry[] = [
  entry(1, { minutesAgo: 5, by: { companyName: k1, memberName: null }, type: "issue_code", transition: b("Approve · A", "اعتماد · A"), outcome: "A" }),
  entry(2, { minutesAgo: 20, by: { companyName: c1, memberName: b("Sara Al Harbi", "سارة الحربي") } }),
  entry(3, {
    minutesAgo: 45,
    type: "claimed",
    transition: null,
    audience: "internal",
    by: { companyName: c1, memberName: b("Omar Fahad", "عمر فهد") },
    workItem: { id: id(3), documentNumber: null, title: "LED panel 600 × 600", type: mar },
  }),
  entry(4, {
    minutesAgo: 90,
    by: { companyName: c1, memberName: b("Omar Fahad", "عمر فهد") },
    transition: b("Send for Review", "إرسال للمراجعة"),
    audience: "internal",
    workItem: { id: id(4), documentNumber: null, title: "Level 2 ceiling layout", type: sar },
  }),
  entry(5, { minutesAgo: 60 * 26, by: { companyName: k1, memberName: null }, type: "issue_code", transition: b("Revise · C", "مراجعة · C"), outcome: "C" }),
];

const types = [
  { ...mar, moduleKey: "submittals" as const },
  { ...sar, moduleKey: "submittals" as const },
  { code: "WIR", name: b("Work Inspection", "فحص الأعمال"), moduleKey: "inspections" as const },
];

const meta = {
  title: "Views/ActivityFeedPanel",
  component: ActivityFeedPanel,
  args: {
    entries,
    hasMore: true,
    query: { type: [], mine: false },
    types,
    locale: "en",
    labels: activityFeedPanelLabels.en,
    itemHref: (itemId: string) => `/work-items/${itemId}`,
    viewAllHref: "/projects/p/activity",
    onQueryChange: fn(),
    onLoadMore: fn(),
  },
  render: (args, context) => <ActivityFeedPanel {...args} locale={storyLocale(context)} labels={activityFeedPanelLabels[storyLocale(context)]} />,
} satisfies Meta<typeof ActivityFeedPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * On the Dashboard: newest first, each entry a link to its item, another
 * Company by its name only, people only of the viewer's own; "View all".
 */
export const Panel: Story = {
  play: async (context) => {
    const feed = within(context.canvas.getByRole("region", { name: storyText(context, copy.title) }));
    const links = feed.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/work-items/"));
    await expect(links.map((l) => l.getAttribute("href"))).toEqual([1, 2, 3, 4, 5].map((n) => `/work-items/${id(n)}`));
    await expect(links[0]).toHaveTextContent(storyText(context, k1));
    await expect(links[0]).toHaveTextContent("TWR-C1-EL-MAR-0001");
    await expect(links[1]).toHaveTextContent(storyText(context, b("Sara Al Harbi", "سارة الحربي")));
    await expect(links[2]).toHaveTextContent(storyText(context, copy.internal));
    await expect(feed.getByRole("link", { name: storyText(context, copy.viewAll) })).toHaveAttribute("href", "/projects/p/activity");
    await userEvent.click(feed.getByRole("button", { name: storyText(context, copy.loadMore) }));
    await expect(context.args.onLoadMore).toHaveBeenCalled();
  },
};

/** "View all": the same feed at full height, with no "View all" link. */
export const FullHeight: Story = {
  args: { fullHeight: true, viewAllHref: undefined },
  play: async (context) => {
    await expect(context.canvas.queryByRole("link", { name: storyText(context, copy.viewAll) })).toBeNull();
    await expect(context.canvas.getAllByRole("listitem")).toHaveLength(5);
  },
};

/** The filters: a Module, then a Type of it, and "items I'm on", each a new query. */
export const Filtering: Story = {
  args: { query: { module: "submittals", type: [], mine: false } },
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("switch", { name: storyText(context, copy.mine) }));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ module: "submittals", type: [], mine: true });
    await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.type) }));
    // Only the chosen Module's Types.
    const options = await screen.findAllByRole("option");
    await expect(options).toHaveLength(3);
    await userEvent.click(await screen.findByRole("option", { name: storyText(context, sar.name) }));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ module: "submittals", type: ["SAR"], mine: false });
  },
};

/** Nothing yet, or nothing matching the filters. */
export const Empty: Story = {
  args: { entries: [], hasMore: false },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.empty))).toBeVisible();
    await expect(context.canvas.queryByRole("button", { name: storyText(context, copy.loadMore) })).toBeNull();
  },
};

/** Narrow: entries wrap, and nothing scrolls sideways. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    await expect(context.canvasElement.scrollWidth).toBeLessThanOrEqual(context.canvasElement.clientWidth);
  },
};
