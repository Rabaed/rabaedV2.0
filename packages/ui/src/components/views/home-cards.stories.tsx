import type { HomeActivityEntry, HomeWorkItem, Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { NeedsMyActionCard, RecentActivityCard, type NeedsMyActionCardLabels, type RecentActivityCardLabels } from "./home-cards.tsx";

// Home's cards (RP-407): what needs a Contractor's PM across two Projects, and
// what happened lately, another Company by its name only (V14). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const tower = { id: "0192e0a0-0000-7000-8000-000000000001", code: "TWR", name: b("Riyadh Gate Tower", "برج بوابة الرياض") };
const villas = { id: "0192e0a0-0000-7000-8000-000000000002", code: "JCV", name: b("Jeddah Corniche Villas", "فلل كورنيش جدة") };
const c1 = b("Al Bina Contracting", "البناء للمقاولات");
const k1 = b("Design Consultants", "المصممون الاستشاريون");
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const id = (n: number) => `0192e0a0-0000-7000-8000-${String(n).padStart(12, "0")}`;

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
  item(1, {}),
  item(2, { title: "Villa pumps", project: villas, projectId: villas.id, documentNumber: "JCV-C1-ME-MAR-0002 Rev 1", stepAgeWeeks: 3 }),
  item(3, { title: "Fire alarm panels", stepAgeWeeks: 5, stage: { key: "resubmitted", name: b("Resubmitted", "معاد تقديمه"), category: "in_progress" } }),
];

const entry = (n: number, over: Partial<HomeActivityEntry>): HomeActivityEntry => ({
  id: id(100 + n),
  type: "transition",
  at: new Date(Date.UTC(2026, 9, 6, 9, 0) - n * 3_600_000).toISOString(),
  audience: "shared",
  by: { companyName: k1, memberName: null },
  transition: b("Return", "إعادة"),
  outcome: null,
  workItem: { id: id(n), documentNumber: `TWR-C1-EL-MAR-000${n}`, title: "Cable tray, galvanised 300 mm", type: mar },
  project: tower,
  ...over,
});

const entries: HomeActivityEntry[] = [
  entry(1, { type: "issue_code", transition: b("Approve · A", "اعتماد · A"), outcome: "A" }),
  entry(2, { by: { companyName: c1, memberName: b("Sara Al Harbi", "سارة الحربي") }, transition: b("Send for Review", "إرسال للمراجعة"), audience: "internal", project: villas }),
  entry(3, { type: "claimed", transition: null, by: { companyName: c1, memberName: b("Omar Fahad", "عمر فهد") }, workItem: { id: id(3), documentNumber: null, title: "LED fittings", type: mar } }),
];

const needsLabels: Record<Locale, NeedsMyActionCardLabels> = {
  en: { title: "Needs my action", empty: "Nothing is waiting on you.", noNumber: "No number yet" },
  ar: { title: "بحاجة لإجرائي", empty: "لا شيء بانتظارك.", noNumber: "بلا رقم بعد" },
};
const activityLabels: Record<Locale, RecentActivityCardLabels> = {
  en: {
    title: "Recent activity",
    empty: "Nothing has happened on the items you can see yet.",
    noNumber: "No number yet",
    internal: "Only your Company sees this",
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
    noNumber: "بلا رقم بعد",
    internal: "لا يراه إلا شركتك",
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

function Cards({ locale, empty = false }: { locale: Locale; empty?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(17.5rem,1fr)]">
      <NeedsMyActionCard
        items={empty ? [] : items}
        locale={locale}
        labels={needsLabels[locale]}
        itemHref={(i) => `#/work-items/${i}`}
        boards={empty ? [] : [tower, villas].map((p) => ({ key: p.id, label: `${boardLabel[locale]} · ${p.code}`, href: `#/projects/${p.id}/work-items?view=kanban` }))}
      />
      <RecentActivityCard entries={empty ? [] : entries} locale={locale} labels={activityLabels[locale]} itemHref={(i) => `#/work-items/${i}`} />
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

/**
 * Each item links to its page with its Subject, Document Number (left to right,
 * in Arabic too), Project, Stage and Step Age; "Open board" per Project. Each
 * activity entry names the Company, and a person only of the viewer's own.
 */
export const Wide: Story = {
  play: async (context) => {
    const needs = context.canvas.getByRole("region", { name: storyText(context, b(needsLabels.en.title, needsLabels.ar.title)) });
    const rows = within(needs).getAllByRole("listitem");
    await expect(rows).toHaveLength(items.length);
    await expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", `#/work-items/${items[0]!.id}`);
    await expectLaidOutLeftToRight(within(rows[1]!).getByText("JCV-C1-ME-MAR-0002 Rev 1"));
    await expect(within(rows[1]!).getByText(new RegExp(storyText(context, villas.name)))).toBeVisible();
    await expect(within(rows[2]!).getByRole("img", { name: /4\+|4/ })).toBeVisible();
    await expect(within(needs).getAllByRole("link", { name: new RegExp(storyText(context, boardLabel)) })).toHaveLength(2);

    const activity = context.canvas.getByRole("region", { name: storyText(context, b(activityLabels.en.title, activityLabels.ar.title)) });
    const lines = within(activity).getAllByRole("listitem");
    await expect(lines).toHaveLength(entries.length);
    await expect(lines[0]).toHaveTextContent(storyText(context, k1));
    await expect(lines[1]).toHaveTextContent(storyText(context, b("Sara Al Harbi", "سارة الحربي")));
    await expect(lines[1]).toHaveTextContent(storyText(context, b("Only your Company sees this", "لا يراه إلا شركتك")));
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
