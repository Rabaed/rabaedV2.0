import { workItemQuery, workItemSearchParams, type WorkItemBoard as WorkItemBoardData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { WorkItemBoard, WorkItemViewSwitch } from "./work-item-board.tsx";
import { WorkItemList } from "./work-item-list.tsx";

// The Submittals Kanban (RP-349, spec RP-344) as a Contractor engineer of
// Tamkeen sees it: Stages as columns, Tamkeen's Steps as swimlanes, the
// Consultant as one lane with its name only (V14). Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  board: b("Kanban", "كانبان"),
  showAll: b("Show all", "عرض الكل"),
  empty: b("No items", "لا توجد عناصر"),
  view: b("View", "طريقة العرض"),
  list: b("List", "قائمة"),
  kanban: b("Kanban", "كانبان"),
  stage: b("Stage", "المرحلة"),
  unclaimed: b("unclaimed", "لم تُستلَم"),
};

const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  internal: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" as const },
  pending: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const },
  approved: { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const },
  revise: { key: "revise_resubmit", name: b("Revise and Resubmit", "تعديل وإعادة تقديم"), category: "closed_negative" as const },
};
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical", "كهرباء") };
const ownCompany = b("Tamkeen Contracting", "تمكين للمقاولات");
const consultant = b("Al Waha PMC", "الواحة لإدارة المشاريع");
const consultantId = "00000000-0000-4000-8000-0000000000c1";
const otherConsultant = b("Saudi Design Group", "المجموعة السعودية للتصميم");
const otherConsultantId = "00000000-0000-4000-8000-0000000000c2";
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const draftStep = { key: "draft", name: b("Draft", "مسودة") };
const reviewStep = { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") };
const sara = b("Sara Al Qahtani", "سارة القحطاني");

const card = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title: "",
  documentNumber: `TWR-TMC-EL-MAR-00${String(n).padStart(2, "0")}`,
  revisionNo: 0,
  stage: stages.pending,
  trade: electrical,
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  with: null,
  ...rest,
});

const withConsultant = { kind: "company", companyName: consultant } as const;
const cards = {
  draft: card(1, { title: "Fire alarm cables", documentNumber: null, stage: stages.draft, with: { kind: "own", companyName: ownCompany, step: draftStep, claimer: { name: sara, isMe: true } } }),
  revisionDraft: card(2, {
    title: "Earthing rods, galvanised",
    documentNumber: null,
    revisionNo: 1,
    stage: stages.draft,
    with: { kind: "own", companyName: ownCompany, step: draftStep, claimer: { name: sara, isMe: true } },
  }),
  review: card(3, { title: "Main LV switchboard", stage: stages.internal, stepAgeWeeks: 2, with: { kind: "own", companyName: ownCompany, step: reviewStep, claimer: null } }),
  pending1: card(4, { title: "Cable tray support brackets", stepAgeWeeks: 4, with: withConsultant }),
  pending2: card(5, { title: "LED downlights", documentNumber: "TWR-TMC-EL-MAR-0005 Rev 1", revisionNo: 1, stepAgeWeeks: 3, with: withConsultant }),
  pending3: card(6, { title: "Smoke detectors", with: { kind: "company", companyName: otherConsultant } }),
  approved: card(7, { title: "Busbar trunking", stage: stages.approved, outcome: "B" }),
  approvedA: card(8, { title: "Distribution boards", stage: stages.approved, outcome: "A" }),
};

const board: WorkItemBoardData = {
  stages: [
    { ...stages.draft, count: 2 },
    { ...stages.internal, count: 1 },
    { ...stages.pending, count: 3 },
    { ...stages.approved, count: 14 },
    { ...stages.revise, count: 3 },
  ],
  filters: {
    types: [mar],
    trades: [electrical],
    locations: [],
    with: {
      steps: [draftStep, reviewStep],
      companies: [
        { participantId: consultantId, name: consultant },
        { participantId: otherConsultantId, name: otherConsultant },
      ],
    },
  },
  columns: [
    { stageKey: "draft", shown: 2, lanes: [{ kind: "step", step: draftStep, count: 2, cards: [cards.draft, cards.revisionDraft] }] },
    { stageKey: "internal_review", shown: 1, lanes: [{ kind: "step", step: reviewStep, count: 1, cards: [cards.review] }] },
    {
      stageKey: "pending_approval",
      shown: 3,
      lanes: [
        { kind: "company", participantId: consultantId, companyName: consultant, count: 2, cards: [cards.pending1, cards.pending2] },
        { kind: "company", participantId: otherConsultantId, companyName: otherConsultant, count: 1, cards: [cards.pending3] },
      ],
    },
    { stageKey: "approved", shown: 2, lanes: [{ kind: "closed", count: 2, cards: [cards.approved, cards.approvedA] }] },
    // Three Code C items, all closed more than 30 days ago.
    { stageKey: "revise_resubmit", shown: 0, lanes: [] },
  ],
};

const defaults: WorkItemQuery = workItemQuery.parse({});
const listHrefFor = (q: WorkItemQuery) => `?${workItemSearchParams(q)}`;

const meta = {
  title: "Views/WorkItemBoard",
  component: WorkItemBoard,
  args: { board, query: defaults, locale: "en", listHrefFor, itemHref: (id: string) => `#${id}` },
  render: (args, context) => <WorkItemBoard {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof WorkItemBoard>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const columnOf = (context: PlayContext, stage: { name: { en: string; ar: string } }) =>
  context.canvas.getByRole("listitem", { name: new RegExp(`^${storyText(context, stage.name)}`) });

/**
 * Wide: a column per Stage with its count, Tamkeen's Steps as lanes, and each
 * Consultant as one lane with its name only (V14). Cards show the Document
 * Number (left to right, in Arabic too), Subject, Step Age dots and the Review
 * Code badge.
 */
export const Wide: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.board) });
    const columns = within(region).getAllByRole("listitem").filter((li) => li.dataset.stage);
    await expect(columns.map((c) => c.dataset.stage)).toEqual(board.stages.map((s) => s.key));

    const pending = columnOf(context, stages.pending);
    const lanes = within(pending).getAllByRole("region");
    await expect(lanes.map((l) => l.getAttribute("aria-label"))).toEqual([consultant[locale], otherConsultant[locale]]);
    await expect(within(lanes[0]!).getAllByRole("link")).toHaveLength(2);
    // Another Company's lane: its name only, no Step and no person.
    await expect(within(pending).queryByText(storyText(context, copy.unclaimed))).toBeNull();

    const review = columnOf(context, stages.internal);
    await expect(within(review).getByRole("region", { name: reviewStep.name[locale] })).toHaveTextContent(storyText(context, copy.unclaimed));

    const number = within(pending).getByText("TWR-TMC-EL-MAR-0005 Rev 1");
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
    const approved = columnOf(context, stages.approved);
    await expect(approved.querySelectorAll("[data-code]")).toHaveLength(2);
    await expect(within(approved).queryByRole("img")).toBeNull();
  },
};

/** Columns run in the reading direction: right to left in Arabic. */
export const ColumnsRunInReadingOrder: Story = {
  play: async (context) => {
    const first = columnOf(context, stages.draft).getBoundingClientRect();
    const second = columnOf(context, stages.internal).getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(second.right).toBeLessThanOrEqual(first.left);
    else await expect(second.left).toBeGreaterThanOrEqual(first.right);
  },
};

/**
 * A closed column holds the last 30 days, with its total and "Show all",
 * which opens the List with the same filters and that Stage.
 */
export const ClosedColumns: Story = {
  args: { query: { ...defaults, trade: [electrical.id], sort: "documentNumber" } },
  play: async (context) => {
    const approved = columnOf(context, stages.approved);
    await expect(within(approved).getByTestId("column-total")).toHaveTextContent("14");
    await expect(within(approved).getByRole("link", { name: new RegExp(storyText(context, stages.approved.name)) })).toHaveAttribute(
      "href",
      `?stage=approved&trade=${electrical.id}&sort=documentNumber`,
    );
    const revise = columnOf(context, stages.revise);
    await expect(within(revise).getByText(storyText(context, copy.empty))).toBeVisible();
    await expect(within(revise).getByTestId("column-total")).toHaveTextContent("3");
  },
};

/** Narrow: the board scrolls sideways in its own region; every card is a 44px touch target. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.board) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    for (const link of within(columnOf(context, stages.pending)).getAllByRole("link")) await expectTouchTarget(link);
  },
};

/** With the toolbar and the List / Kanban switch, as the Submittals tab shows it. */
export const WithToolbar: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="space-y-4">
        <WorkItemViewSwitch view="kanban" locale={locale} hrefFor={(v) => (v === "kanban" ? "?view=kanban" : "?")} />
        <WorkItemList
          list={{ ...board, items: [], nextCursor: null }}
          query={args.query}
          locale={locale}
          hrefFor={listHrefFor}
          itemHref={args.itemHref}
          onQueryChange={fn()}
          board={<WorkItemBoard {...args} locale={locale} />}
        />
      </div>
    );
  },
  play: async (context) => {
    const views = context.canvas.getByRole("navigation", { name: storyText(context, copy.view) });
    await expect(within(views).getByRole("link", { name: storyText(context, copy.kanban) })).toHaveAttribute("aria-current", "page");
    await expect(within(views).getByRole("link", { name: storyText(context, copy.list) })).not.toHaveAttribute("aria-current");
    await expect(context.canvas.getByRole("combobox", { name: storyText(context, copy.stage) })).toBeVisible();
    // The board replaces the List's table and pages.
    await expect(context.canvas.queryByRole("table")).toBeNull();
    await expect(context.canvas.getByRole("region", { name: storyText(context, copy.board) })).toBeVisible();
  },
};

/** The toolbar and the board on a phone. */
export const WithToolbarNarrow: Story = { ...WithToolbar, parameters: phone, play: undefined };
