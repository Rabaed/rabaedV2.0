import {
  workItemQuery,
  workItemSearchParams,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { viewSwitchLabels, workItemBoardLabels, workItemListLabels } from "../../storybook/views.ts";
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
  moveItem: b("Move #", "نقل #"),
  moveTo: b("To #", "إلى #"),
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
  submissionDate: null,
  creationDate: null,
  with: null,
  ...rest,
});

const withConsultant = { kind: "company", companyName: consultant } as const;
const cards = {
  draft: card(1, { title: "Fire alarm cables", documentNumber: null, stepEnteredAt: null, stepAgeWeeks: null, stage: stages.draft, with: { kind: "own", companyName: ownCompany, step: draftStep, claimer: { name: sara, isMe: true } } }),
  revisionDraft: card(2, {
    title: "Earthing rods, galvanised",
    documentNumber: null,
    stepEnteredAt: null,
    stepAgeWeeks: null,
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
  moves: {},
};

// What Sara may do with her Draft "Fire alarm cables" now (RP-350): two
// Transitions lead to Pending Approval, so that Stage is no drop target. Her
// Revision Draft has none, and nobody she may not act for has a card here.
const move = (transition: string, label: { en: string; ar: string }, kind: WorkItemMove["kind"], stageKey: string): WorkItemMove => ({
  transition,
  label,
  kind,
  stageKey,
  actionForm: null,
});
const sendForReview = move("send_for_review", b("Send for Review", "إرسال للمراجعة"), "send", "internal_review");
const cancel = move("cancel", b("Cancel", "إلغاء"), "cancel", "revise_resubmit");
const boardWithMoves: WorkItemBoardData = {
  ...board,
  moves: {
    [cards.draft.id]: [
      sendForReview,
      move("submit_standard", b("Submit as standard", "تقديم عادي"), "submit", "pending_approval"),
      move("submit_fast", b("Submit fast track", "تقديم مستعجل"), "submit", "pending_approval"),
      cancel,
    ],
  },
};

const defaults: WorkItemQuery = workItemQuery.parse({});
const listHrefFor = (q: WorkItemQuery) => `?${workItemSearchParams(q)}`;

const meta = {
  title: "Views/WorkItemBoard",
  component: WorkItemBoard,
  args: { board, query: defaults, locale: "en", labels: workItemBoardLabels.en, listHrefFor, itemHref: (id: string) => `#${id}` },
  render: (args, context) => <WorkItemBoard {...args} locale={storyLocale(context)} labels={workItemBoardLabels[storyLocale(context)]} />,
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
    // In the viewer's alphabetical order: Al Waha before Saudi Design Group in English, المجموعة before الواحة in Arabic.
    const alWahaFirst = locale === "en";
    await expect(lanes.map((l) => l.getAttribute("aria-label"))).toEqual(
      alWahaFirst ? [consultant.en, otherConsultant.en] : [otherConsultant.ar, consultant.ar],
    );
    await expect(within(lanes[alWahaFirst ? 0 : 1]!).getAllByRole("link")).toHaveLength(2);
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

/**
 * Under a search, a closed column gives no total: a search counts only what it
 * shows. "Show all" still opens the List with the same search and that Stage.
 */
export const ClosedColumnsUnderSearch: Story = {
  args: { query: { ...defaults, q: "busbar" } },
  play: async (context) => {
    for (const stage of [stages.approved, stages.revise]) {
      const column = columnOf(context, stage);
      await expect(within(column).queryByTestId("column-total")).toBeNull();
      await expect(within(column).queryByText(/in total|إجمالًا/)).toBeNull();
      await expect(within(column).getByRole("link", { name: new RegExp(storyText(context, stage.name)) })).toHaveAttribute(
        "href",
        `?stage=${stage.key}&q=busbar`,
      );
    }
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

const draftCard = (context: PlayContext) => columnOf(context, stages.draft).querySelector<HTMLElement>(`li[data-movable]`)!;
const dragData = () => ({ dataTransfer: new DataTransfer() });
const targetColumns = (context: PlayContext) =>
  context.canvas.getAllByRole("listitem").filter((li) => li.dataset.stage && li.hasAttribute("data-drop-target")).map((li) => li.dataset.stage);

/**
 * Dragging a card Sara may act on highlights only the Stages one of its
 * Transitions alone leads to: Pending Approval, which two lead to, is not one,
 * nor is the Stage the card is in. Dropping on a target opens that
 * Transition's Action Form (here, `onMove`); dropping elsewhere does nothing.
 * A card she may not act on can't be dragged. Left mid-drag for the screenshot.
 */
export const DraggingWithTargets: Story = {
  args: { board: boardWithMoves, onMove: fn() },
  play: async (context) => {
    const onMove = context.args.onMove as ReturnType<typeof fn>;
    const card = draftCard(context);
    await expect(card).toHaveAttribute("draggable", "true");
    // The other Draft, the Consultant's cards and the closed ones have nothing to take.
    await expect(context.canvas.getAllByRole("listitem").filter((li) => li.hasAttribute("data-movable"))).toHaveLength(1);
    await expect(targetColumns(context)).toEqual([]);

    fireEvent.dragStart(card, dragData());
    await waitFor(() => expect(targetColumns(context)).toEqual(["internal_review", "revise_resubmit"]));

    // Dropping on a Stage that is no target does nothing.
    fireEvent.drop(columnOf(context, stages.pending), dragData());
    fireEvent.drop(columnOf(context, stages.draft), dragData());
    await expect(onMove).not.toHaveBeenCalled();

    fireEvent.drop(columnOf(context, stages.internal), dragData());
    await expect(onMove).toHaveBeenCalledWith(cards.draft, sendForReview);
    await waitFor(() => expect(targetColumns(context)).toEqual([]));

    // Left dragging again, so the highlighted columns are what the screenshot shows.
    fireEvent.dragStart(card, dragData());
    await waitFor(() => expect(targetColumns(context)).toHaveLength(2));
  },
};

/** Dragging on a phone: the board scrolls sideways, the targets are still highlighted. */
export const DraggingNarrow: Story = { ...DraggingWithTargets, parameters: phone, play: undefined };

/** The same moves from the card's menu, for the keyboard and screen readers: no drag needed. */
export const MovingFromTheMenu: Story = {
  args: { board: boardWithMoves, onMove: fn() },
  play: async (context) => {
    const onMove = context.args.onMove as ReturnType<typeof fn>;
    const trigger = within(draftCard(context)).getByRole("button", { name: storyText(context, copy.moveItem).replace("#", cards.draft.title) });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("dialog", { name: storyText(context, copy.moveItem).replace("#", cards.draft.title) });
    // The same targets as dragging: the Stage two Transitions lead to is not offered.
    const choices = within(menu).getAllByRole("button");
    await expect(choices.map((c) => c.textContent)).toEqual([
      `${sendForReview.label[storyLocale(context)]}${storyText(context, copy.moveTo).replace("#", stages.internal.name[storyLocale(context)])}`,
      `${cancel.label[storyLocale(context)]}${storyText(context, copy.moveTo).replace("#", stages.revise.name[storyLocale(context)])}`,
    ]);
    await userEvent.keyboard("{Tab}{Enter}");
    await expect(onMove).toHaveBeenCalledWith(cards.draft, cancel);
    // A card with nothing to take has no menu.
    await expect(context.canvas.getAllByRole("button", { name: /^(Move|نقل)/ })).toHaveLength(1);
  },
};

/** Without `onMove`, even a card with moves can't be dragged or moved. */
export const NoMoveHandler: Story = {
  args: { board: boardWithMoves },
  play: async (context) => {
    await expect(context.canvas.queryAllByRole("button", { name: /^(Move|نقل)/ })).toHaveLength(0);
    await expect(context.canvas.getAllByRole("listitem").filter((li) => li.hasAttribute("data-movable"))).toHaveLength(0);
  },
};

/** With the toolbar and the List / Kanban switch, as the Submittals tab shows it. */
export const WithToolbar: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className="space-y-4">
        <WorkItemViewSwitch view="kanban" labels={viewSwitchLabels[locale]} hrefFor={(v) => (v === "kanban" ? "?view=kanban" : "?")} />
        <WorkItemList
          list={{ ...board, items: [], nextCursor: null }}
          query={args.query}
          locale={locale}
          labels={workItemListLabels[locale]}
          hrefFor={listHrefFor}
          itemHref={args.itemHref}
          onQueryChange={fn()}
          board={<WorkItemBoard {...args} locale={locale} labels={workItemBoardLabels[locale]} />}
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
