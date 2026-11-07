import type { ActivityFeedEntry, Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { activityFeedPanelLabels } from "../../storybook/views.ts";
import { ActivityFeedPage, type ActivityFeedPageLabels } from "./activity-feed-page.tsx";

// The Activity Feed page (RP-1157, the owner's `Rabaed Activity.html`): entries by day, each
// "<who> <did what> <Document Number> · Subject" with its chips. Another Company by its name and a
// neutral tile only; people only of the viewer's own Company. Story data only, as a Contractor sees it.
const b = (en: string, ar: string) => ({ en, ar });

const pageLabels = (locale: Locale): ActivityFeedPageLabels => {
  const panel = activityFeedPanelLabels[locale];
  const en = locale === "en";
  return {
    ...panel,
    description: en
      ? "What happened on Tower's Work Items, as you may see it. Answer changes and Document uploads aren't listed."
      : "ما حدث على عناصر عمل البرج، كما يحق لك رؤيته. لا تُدرج تغييرات الإجابات ولا رفع المستندات.",
    allModules: en ? "All modules" : "كل الوحدات",
    allTypes: en ? "All types" : "كل الأنواع",
    count: (n) => (en ? `${n} entries` : `${n} إدخال`),
    today: en ? "Today" : "اليوم",
    yesterday: en ? "Yesterday" : "أمس",
    you: en ? "(you)" : "(أنت)",
    onItem: en ? "You're on this item" : "أنت على هذا العنصر",
    code: (code) => (en ? `Code ${code}` : `الرمز ${code}`),
    scrollForOlder: en ? "Scroll for older entries" : "مرّر لعرض الإدخالات الأقدم",
    emptyTitle: en ? "Nothing here" : "لا شيء هنا",
    emptyFiltered: en ? "No entries match these filters." : "لا توجد إدخالات تطابق هذه المرشحات.",
    emptyNone: panel.empty,
  };
};

const c1 = b("Al Bina Contracting", "البناء للمقاولات");
const k1 = b("Design Consultants", "المصممون الاستشاريون");
const sara = b("Sara Al Harbi", "سارة الحربي");
const omar = b("Omar Fahad", "عمر فهد");
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const wir = { code: "WIR", name: b("Work Inspection", "فحص الأعمال") };
const id = (n: number) => `0192e0a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
/** 9:00 in Riyadh on 6 October 2026: the story's "now". */
const now = new Date(Date.UTC(2026, 9, 6, 6, 0));

const entry = (n: number, over: Partial<ActivityFeedEntry> & { minutesAgo: number }): ActivityFeedEntry => {
  const { minutesAgo, ...rest } = over;
  return {
    id: id(100 + n),
    type: "transition",
    at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    audience: "shared",
    by: { companyName: c1, memberName: null },
    transition: b("Submit", "تقديم"),
    outcome: null,
    outcomeChip: null,
    workItem: { id: id(n), documentNumber: `TWR-C1-EL-MAR-000${n}`, title: "Cable tray, galvanised 300 mm", type: mar },
    onItem: false,
    byMe: false,
    ...rest,
  };
};

const entries: ActivityFeedEntry[] = [
  entry(1, {
    minutesAgo: 5,
    by: { companyName: k1, memberName: null },
    type: "issue_code",
    transition: b("Revise · C", "مراجعة · C"),
    outcome: "C",
    outcomeChip: { name: null, look: "c" },
    onItem: true,
  }),
  entry(2, { minutesAgo: 20, by: { companyName: c1, memberName: sara }, byMe: true, onItem: true }),
  entry(3, {
    minutesAgo: 45,
    audience: "internal",
    by: { companyName: c1, memberName: omar },
    transition: b("Send for Review", "إرسال للمراجعة"),
    workItem: { id: id(3), documentNumber: null, title: "LED panel 600 × 600", type: mar },
  }),
  entry(4, {
    minutesAgo: 60 * 20,
    by: { companyName: k1, memberName: null },
    type: "issue_code",
    transition: b("Pass", "نجاح"),
    outcome: "passed",
    outcomeChip: { name: b("Passed", "ناجح"), look: "a" },
    workItem: { id: id(4), documentNumber: "TWR-C1-EL-WIR-0004", title: "Lighting first fix, L3", type: wir },
  }),
  entry(5, { minutesAgo: 60 * 75, by: { companyName: c1, memberName: sara }, byMe: true, onItem: true }),
];

const types = [
  { ...mar, moduleKey: "submittals" as const },
  { code: "SAR", name: b("Shop Drawing Submittal", "اعتماد مخططات تنفيذية"), moduleKey: "submittals" as const },
  { ...wir, moduleKey: "inspections" as const },
];

const meta = {
  title: "Views/ActivityFeedPage",
  component: ActivityFeedPage,
  args: {
    entries,
    hasMore: true,
    query: { type: [], mine: false },
    types,
    locale: "en",
    labels: pageLabels("en"),
    itemHref: (itemId: string) => `/work-items/${itemId}`,
    now: now.toISOString(),
    onQueryChange: fn(),
    onLoadMore: fn(),
  },
  render: (args, context) => <ActivityFeedPage {...args} locale={storyLocale(context)} labels={pageLabels(storyLocale(context))} />,
} satisfies Meta<typeof ActivityFeedPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grouped by day, newest first; each entry a link to its item with its chips. */
export const Page: Story = {
  play: async (context) => {
    const labels = pageLabels(storyLocale(context));
    const today = within(context.canvas.getByRole("region", { name: new RegExp(`^${labels.today}`) }));
    const links = today.getAllByRole("link");
    await expect(links).toHaveLength(3);
    // Another Company by its name, with its Code's chip.
    await expect(links[0]).toHaveTextContent(storyText(context, k1));
    await expect(links[0]).toHaveTextContent(labels.code("C"));
    await expect(links[0]).toHaveTextContent(labels.onItem);
    // The viewer's own entry: "(you)".
    await expect(links[1]).toHaveTextContent(`${storyText(context, sara)} ${labels.you}`);
    // Another Member of the viewer's Company: no "(you)", and an internal move's chip.
    await expect(links[2]).not.toHaveTextContent(labels.you);
    await expect(links[2]).toHaveTextContent(labels.internal);
    // Yesterday, then a dated day.
    await expect(context.canvas.getByRole("region", { name: new RegExp(`^${labels.yesterday}`) })).toBeVisible();
    await expect(context.canvas.getAllByRole("region")).toHaveLength(3);
    await expect(context.canvas.getByText(labels.count(5))).toBeVisible();
  },
};

/** "Scroll for older entries" loads the next page on a click or a key too, for keyboard users. */
export const LoadMore: Story = {
  play: async (context) => {
    const labels = pageLabels(storyLocale(context));
    await expect(context.canvas.getByText(labels.scrollForOlder)).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: labels.scrollForOlder }));
    await expect(context.args.onLoadMore).toHaveBeenCalled();
  },
};

/** "Only items I'm on" is a new query. */
export const Mine: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("switch"));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ type: [], mine: true });
  },
};

/** Nothing matches the filters. */
export const Empty: Story = {
  args: { entries: [], hasMore: false, query: { type: [], mine: true } },
  play: async (context) => {
    const labels = pageLabels(storyLocale(context));
    await expect(context.canvas.getByText(labels.emptyTitle)).toBeVisible();
    await expect(context.canvas.getByText(labels.emptyFiltered)).toBeVisible();
  },
};

/** Phone: the filters wrap, the time goes under each entry, and nothing scrolls sideways. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expect(context.canvasElement.scrollWidth).toBeLessThanOrEqual(context.canvasElement.clientWidth);
  },
};
