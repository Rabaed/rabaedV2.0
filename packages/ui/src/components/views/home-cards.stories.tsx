import { formatDate, formatNumber, relativeAge, type HomeActivityEntry, type HomeWorkItem, type Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { NeedsMyActionCard, RecentActivityCard, type NeedsMyActionCardLabels, type RecentActivityCardLabels } from "./home-cards.tsx";

// Home's cards (RP-407), as the design kit draws them: what needs a Contractor's
// PM across two Projects, and what happened lately: his own Company's people by
// name, another Company by its name only (V14). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const tower = { id: "0192e0a0-0000-7000-8000-000000000001", code: "TWR", name: b("Riyadh Gate Tower", "برج بوابة الرياض") };
const villas = { id: "0192e0a0-0000-7000-8000-000000000002", code: "JCV", name: b("Jeddah Corniche Villas", "فلل كورنيش جدة") };
const c1 = b("Al Bina Contracting", "البناء للمقاولات");
const k1 = b("Design Consultants", "المصممون الاستشاريون");
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const id = (n: number) => `0192e0a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
/** The stories' "now": relative times are counted from it. */
const now = new Date("2026-10-10T09:00:00.000Z");

const item = (n: number, over: Partial<HomeWorkItem>): HomeWorkItem => ({
  id: id(n),
  projectId: tower.id,
  project: tower,
  moduleKey: "submittals",
  type: mar,
  title: "Cable tray, galvanised 300 mm",
  documentNumber: `TWR-C1-EL-MAR-000${n}`,
  revisionNo: 0,
  stage: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" },
  trade: { id: id(90), code: "EL", name: b("Electrical", "كهرباء") },
  location: null,
  stepEnteredAt: "2026-10-05T08:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  with: { kind: "own", companyName: c1, step: { key: "pm_review", name: b("PM Review", "مراجعة مدير المشروع") }, claimer: null },
  submissionDate: null,
  creationDate: null,
  ...over,
});

const items: HomeWorkItem[] = [
  item(1, { title: "Fire Suppression System", documentNumber: "TWR-C1-EL-MAR-0001 Rev 2", revisionNo: 2 }),
  item(2, { title: "Villa pumps", project: villas, projectId: villas.id, documentNumber: "JCV-C1-ME-MAR-0002", stepAgeWeeks: 3 }),
  item(3, { title: "Fire alarm panels", stepAgeWeeks: 5, stage: { key: "resubmitted", name: b("Resubmitted", "معاد تقديمه"), category: "in_progress" } }),
];

const minutes = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
const entry = (n: number, at: string, over: Partial<HomeActivityEntry>): HomeActivityEntry => ({
  id: id(100 + n),
  type: "transition",
  at,
  audience: "shared",
  by: { companyName: k1, memberName: null },
  transition: b("Return", "إعادة"),
  outcome: null,
  workItem: { id: id(n), documentNumber: `TWR-C1-EL-MAR-000${n}`, title: "Lighting Fixtures", type: mar },
  project: tower,
  ...over,
});

const sara = b("Sara Al Harbi", "سارة الحربي");
const entries: HomeActivityEntry[] = [
  // Another Company: by its name only, with its square avatar.
  entry(1, minutes(10), { type: "issue_code", transition: b("Approve as Noted · B", "اعتماد مع ملاحظات · B"), outcome: "B" }),
  // My own Company: the person, with a round avatar.
  entry(2, minutes(60), { by: { companyName: c1, memberName: sara }, transition: b("Submit", "تقديم"), workItem: { id: id(2), documentNumber: null, title: "Fire Suppression System", type: mar }, project: villas }),
  entry(3, minutes(180), { type: "claimed", transition: null, by: { companyName: c1, memberName: b("Omar Fahad", "عمر فهد") }, workItem: { id: id(3), documentNumber: null, title: "LED fittings", type: mar } }),
  entry(4, minutes(60 * 30), { workItem: { id: id(4), documentNumber: null, title: "Non-compliant materials", type: mar } }),
];

const needsLabels: Record<Locale, NeedsMyActionCardLabels> = {
  en: { title: "Needs my action", empty: "Nothing is waiting on you.", noNumber: "No number yet", revision: (n) => `R${n}`, viewAll: "View all", otherBoards: "Other boards" },
  ar: { title: "بحاجة لإجرائي", empty: "لا شيء بانتظارك.", noNumber: "بلا رقم بعد", revision: (n) => `R${n}`, viewAll: "عرض الكل", otherBoards: "لوحات أخرى" },
};
const activityLabels: Record<Locale, RecentActivityCardLabels> = {
  en: {
    title: "Recent activity",
    empty: "Nothing has happened on the items you can see yet.",
    viewAll: "View all",
    code: (code) => `(Code ${code})`,
    claimed: "claimed",
    released: "released to the pool",
    assigned: "assigned",
    internalNote: "wrote an Internal Note with",
    recommended: "recommended a Code on",
    cancelled: "cancelled",
    updated: "updated",
  },
  ar: {
    title: "آخر النشاطات",
    empty: "لم يحدث شيء بعد على العناصر التي يمكنك رؤيتها.",
    viewAll: "عرض الكل",
    code: (code) => `(Code ${code})`,
    claimed: "استلم",
    released: "أعاد إلى المجموعة",
    assigned: "أسند",
    internalNote: "كتب ملاحظة داخلية مع",
    recommended: "أوصى برمز على",
    cancelled: "ألغى",
    updated: "حدّث",
  },
};
const boardLabel = b("Open board", "فتح اللوحة");

/** The stories' relative time, as the app words it: "10m ago", "1h ago", then the date. */
function when(at: string, locale: Locale): string {
  const age = relativeAge(at, now);
  if (age.unit === "now") return locale === "ar" ? "الآن" : "just now";
  if (age.unit === "date") return formatDate(new Date(at), locale);
  const n = formatNumber(age.count, locale);
  if (locale === "ar") return age.unit === "minutes" ? `منذ ${n} دقائق` : age.count === 1 ? "منذ ساعة" : `منذ ${n} ساعات`;
  return `${n}${age.unit === "minutes" ? "m" : "h"} ago`;
}

function Cards({ locale, empty = false, more = false }: { locale: Locale; empty?: boolean; more?: boolean }) {
  return (
    <div className="grid items-stretch gap-[18px] min-[1101px]:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <NeedsMyActionCard
        items={empty ? [] : items}
        locale={locale}
        labels={needsLabels[locale]}
        itemHref={(i) => `#/work-items/${i}`}
        boards={empty ? [] : [tower, villas].map((p, i) => ({ key: p.id, label: i === 0 ? boardLabel[locale] : `${boardLabel[locale]} · ${p.code}`, href: `#/projects/${p.id}/board` }))}
        {...(more ? { viewAllHref: `#/projects/${tower.id}/work-items` } : {})}
      />
      <RecentActivityCard
        entries={empty ? [] : entries}
        locale={locale}
        labels={activityLabels[locale]}
        when={(at) => when(at, locale)}
        itemHref={(i) => `#/work-items/${i}`}
        {...(more ? { viewAllHref: `#/projects/${tower.id}/activity` } : {})}
      />
    </div>
  );
}

const meta = {
  title: "Views/HomeCards",
  component: Cards,
  args: { locale: "en" },
  render: (args, context) => <Cards {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof Cards>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const needsOf = (context: PlayContext) => context.canvas.getByRole("region", { name: storyText(context, b(needsLabels.en.title, needsLabels.ar.title)) });
const activityOf = (context: PlayContext) => context.canvas.getByRole("region", { name: storyText(context, b(activityLabels.en.title, activityLabels.ar.title)) });

/**
 * Needs my action, as the kit's rows: Subject, then the Document Number (left to
 * right, in Arabic too), "R2" for a Revision, and the Project; the Stage at the
 * end; no Step Age dots. One "Open board" (the busiest Project), the others in its menu.
 */
export const NeedsMyAction: Story = {
  play: async (context) => {
    const needs = needsOf(context);
    const rows = within(needs).getAllByRole("listitem");
    await expect(rows).toHaveLength(items.length);
    await expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", `#/work-items/${items[0]!.id}`);
    // The number without its " Rev 2", which "R2" carries.
    await expectLaidOutLeftToRight(within(rows[0]!).getByText("TWR-C1-EL-MAR-0001"));
    await expect(rows[0]).toHaveTextContent(/TWR-C1-EL-MAR-0001 · R2 · /);
    await expect(within(rows[1]!).getByText(new RegExp(storyText(context, villas.name)))).toBeVisible();
    await expect(within(rows[2]!).getByText(storyText(context, b("Resubmitted", "معاد تقديمه")))).toBeVisible();
    await expect(within(needs).queryByRole("img")).toBeNull();
    await expect(within(needs).getAllByRole("link", { name: storyText(context, boardLabel) })).toHaveLength(1);
    await userEvent.click(within(needs).getByRole("button", { name: storyText(context, b("Other boards", "لوحات أخرى")) }));
    await expect(await within(document.body).findByRole("link", { name: `${storyText(context, boardLabel)} · JCV` })).toBeVisible();
    await userEvent.keyboard("{Escape}");
  },
};

/**
 * Recent activity, as the kit's entries: my own Company's person with a round
 * avatar, another Company by its name only with a square one (V14); the Subject
 * and the Code on one line; "10m ago", "1h ago", "3h ago", then the date.
 */
export const RecentActivity: Story = {
  play: async (context) => {
    const lines = within(activityOf(context)).getAllByRole("listitem");
    await expect(lines).toHaveLength(entries.length);
    await expect(lines[0]).toHaveTextContent(storyText(context, k1));
    await expect(lines[0]).toHaveTextContent("(Code B)");
    await expect(lines[0]).not.toHaveTextContent("· B");
    await expect(lines[1]).toHaveTextContent(storyText(context, sara));
    await expect(lines[1]).not.toHaveTextContent(storyText(context, c1));
    const times = lines.map((l) => within(l).getByText((_, el) => el?.tagName === "TIME").textContent);
    await expect(times).toEqual(
      storyLocale(context) === "ar"
        ? ["منذ 10 دقائق", "منذ ساعة", "منذ 3 ساعات", formatDate(new Date(entries[3]!.at), "ar")]
        : ["10m ago", "1h ago", "3h ago", formatDate(new Date(entries[3]!.at), "en")],
    );
  },
};

/** More waiting and more activity than the cards show: "View all" at each card's foot; the cards are as tall as each other. */
export const WithMore: Story = {
  args: { more: true },
  play: async (context) => {
    const [needs, activity] = [needsOf(context), activityOf(context)];
    await expect(within(needs).getByRole("link", { name: storyText(context, b("View all", "عرض الكل")) })).toBeVisible();
    await expect(within(activity).getByRole("link", { name: storyText(context, b("View all", "عرض الكل")) })).toHaveAttribute("href", `#/projects/${tower.id}/activity`);
    const [n, a] = [needs.getBoundingClientRect(), activity.getBoundingClientRect()];
    if (n.top === a.top) await expect(n.height).toBe(a.height);
  },
};

/** Nothing waiting and nothing new: each card says so, and offers no board. */
export const Empty: Story = {
  args: { empty: true },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, b(needsLabels.en.empty, needsLabels.ar.empty)))).toBeVisible();
    await expect(context.canvas.getByText(storyText(context, b(activityLabels.en.empty, activityLabels.ar.empty)))).toBeVisible();
    await expect(context.canvas.queryByRole("link")).toBeNull();
  },
};

/** Phone: the cards stack and each row is a touch target. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const [needs, activity] = context.canvas.getAllByRole("region").map((r) => r.getBoundingClientRect());
    await expect(activity!.top).toBeGreaterThanOrEqual(needs!.bottom);
    await expectTouchTarget(context.canvas.getAllByRole("link")[0]!);
  },
};
