import {
  defaultBoardCardLayout,
  defaultOutcomeSets,
  workItemQuery,
  workItemSearchParams,
  type BoardCardLayout,
  type WorkItemBoard as WorkItemBoardData,
  type WorkItemMove,
  type WorkItemQuery,
  type WorkItemRow,
} from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { boardLayoutMenuLabels, viewSwitchLabels, workItemBoardLabels, workItemListLabels } from "../../storybook/views.ts";
import { BoardLayoutMenu } from "./board-layout-menu.tsx";
import { WorkItemBoard, WorkItemViewSwitch } from "./work-item-board.tsx";
import { WorkItemList } from "./work-item-list.tsx";

// The Submittals Kanban (RP-349; rebuilt to the owner's Kanban Board Anatomy,
// RP-410) as a Contractor engineer of Al Futtaim sees it: a column per Stage
// but Drafts, Al Futtaim's Steps as groups, the Consultant as one group with
// its name only (V5, V14), the closed items as "Mixed". Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  board: b("Kanban", "كانبان"),
  empty: b("No items", "لا توجد عناصر"),
  view: b("View", "طريقة العرض"),
  list: b("List", "قائمة"),
  kanban: b("Kanban", "كانبان"),
  notPickedUp: b("Not picked up", "لم تُستلَم"),
  moveItem: b("Move #", "نقل #"),
  moveTo: b("To #", "إلى #"),
  mixed: b("Mixed", "مختلط"),
};

const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  internal: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" as const },
  resubmitted: { key: "revise_resubmit", name: b("Revised & Resubmitted", "معدَّل ومعاد تقديمه"), category: "in_progress" as const },
  pending: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const },
  approved: { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const },
  rejected: { key: "rejected", name: b("Rejected", "مرفوض"), category: "closed_negative" as const },
  cancelled: { key: "cancelled", name: b("Cancelled", "ملغى"), category: "cancelled" as const },
};
const trades = {
  electrical: { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") },
  mechanical: { id: "00000000-0000-4000-8000-0000000000e2", code: "ME", name: b("Mechanical Works", "أعمال ميكانيكية") },
  civil: { id: "00000000-0000-4000-8000-0000000000e3", code: "CV", name: b("Civil Works", "أعمال مدنية") },
};
const level = { zone: b("Zone", "المنطقة"), building: b("Building", "المبنى"), floor: b("Floor", "الطابق") };
const loc = (n: number, depth: number, parentId: string | null, name: { en: string; ar: string }, levelName: { en: string; ar: string }) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  code: `L${n}`,
  name,
  parentId,
  depth,
  levelName,
});
const zoneA = loc(1, 1, null, b("Zone A", "المنطقة A"), level.zone);
const zoneB = loc(2, 1, null, b("Zone B", "المنطقة B"), level.zone);
const b1 = loc(3, 2, zoneA.id, b("Building 1", "المبنى 1"), level.building);
const b2 = loc(4, 2, zoneA.id, b("Building 2", "المبنى 2"), level.building);
const zb1 = loc(5, 2, zoneB.id, b("Building 1", "المبنى 1"), level.building);
const f5 = loc(6, 3, b2.id, b("Floor 5", "الطابق 5"), level.floor);
const fG = loc(7, 3, zb1.id, b("Floor G", "الطابق G"), level.floor);
const locations = [zoneA, zoneB, b1, b2, zb1, f5, fG];
const at = (l: (typeof locations)[number]) => ({ id: l.id, code: l.code, name: l.name });

const ownCompany = b("Al Futtaim Contracting", "شركة الفطيم للمقاولات");
const consultant = b("Design Consultants", "المستشارون للتصميم");
const consultantId = "00000000-0000-4000-8000-0000000000c1";
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };
const sar = { code: "SAR", name: b("Shop Drawing Submittal", "اعتماد مخططات") };
const draftStep = { key: "draft", name: b("Draft", "مسودة") };
const reviewStep = { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") };
// My own roles: a Position with my Project Role (RP-410).
const contractor = b("Contractor", "المقاول");
const engineer = { key: "engineer", name: b("Engineer", "مهندس"), sort: 1 };
const pm = { key: "project_manager", name: b("Project Manager", "مدير المشروع"), sort: 2 };
const engineerLane = b("Contractor Engineer", "مهندس المقاول");
const pmLane = b("Contractor Project Manager", "مدير المشروع المقاول");
const person = (en: string, ar: string, isMe = false) => ({ name: b(en, ar), isMe });
const own = (position: typeof engineer, holder: ReturnType<typeof person> | null, step = reviewStep) =>
  ({ kind: "own", companyName: ownCompany, step, holder, role: { position, projectRole: contractor } }) as const;
const withConsultant = { kind: "company", companyName: consultant } as const;

const card = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title: "",
  documentNumber: `127893${String(n).padStart(2, "0")}`,
  revisionNo: 0,
  stage: stages.internal,
  trade: trades.electrical,
  location: at(f5),
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  submissionDate: "2026-06-12T09:00:00.000Z",
  creationDate: "2026-06-15T09:00:00.000Z",
  with: null,
  raiserCompanyName: ownCompany,
  ...rest,
});

const cards = {
  draft: card(1, { title: "Fire alarm cables", documentNumber: null, stepEnteredAt: null, stepAgeWeeks: null, stage: stages.draft, with: own(engineer, person("Sara Al Qahtani", "سارة القحطاني", true), draftStep) }),
  fire: card(28, { title: "Fire Suppression System", stepAgeWeeks: 2, with: own(engineer, person("Ahmed bin Said", "أحمد بن سعيد", true)) }),
  hvac: card(19, {
    title: "HVAC Ducting",
    trade: trades.mechanical,
    location: at(b1),
    stepAgeWeeks: 5,
    creationDate: "2026-06-12T09:00:00.000Z",
    with: own(engineer, person("Abdullah Al Saadi", "عبدالله السعدي")),
  }),
  pool: card(33, { title: "Lighting Control Panels", location: at(zoneB), stepAgeWeeks: 1, with: own(pm, null) }),
  r2: card(31, {
    title: "Fire Suppression System",
    // Issued with its Revision; the card shows the number alone, the R badge the Revision.
    documentNumber: "12789331 Rev 2",
    stage: stages.resubmitted,
    revisionNo: 2,
    stepAgeWeeks: 3,
    with: own(engineer, person("Nasser Al Kaabi", "ناصر الكعبي")),
  }),
  r3: card(35, { title: "Chilled Water Pipes", stage: stages.resubmitted, revisionNo: 3, trade: trades.mechanical, location: at(fG), with: own(pm, person("Khalid Al Dhaheri", "خالد الظاهري")) }),
  pending1: card(40, { title: "Cable Tray Supports", stage: stages.pending, creationDate: null, stepAgeWeeks: 2, with: withConsultant, raiserCompanyName: ownCompany }),
  pending2: card(41, { title: "Drainage System", type: sar, stage: stages.pending, trade: trades.civil, location: at(fG), revisionNo: 1, creationDate: null, with: withConsultant }),
  codeA: card(20, { title: "Concrete Mix Design", type: sar, stage: stages.approved, trade: trades.civil, location: at(fG), outcome: "A", stepAgeWeeks: null, closedBy: { kind: "company", companyName: consultant } }),
  codeB: card(22, { title: "Busbar Trunking", stage: stages.approved, outcome: "B", stepAgeWeeks: null, location: at(b2), closedBy: { kind: "company", companyName: consultant } }),
  codeD: card(24, { title: "Pump Sets", stage: stages.rejected, trade: trades.mechanical, outcome: "D", stepAgeWeeks: null, location: at(b1), closedBy: { kind: "company", companyName: consultant } }),
};

const board: WorkItemBoardData = {
  stages: [
    { ...stages.draft, count: 1 },
    { ...stages.internal, count: 3 },
    { ...stages.resubmitted, count: 2 },
    { ...stages.pending, count: 2 },
    { ...stages.approved, count: 14 },
    { ...stages.rejected, count: 1 },
    { ...stages.cancelled, count: 3 },
  ],
  filters: {
    types: [mar, sar],
    outcomes: [...defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })), ...defaultOutcomeSets.review_code.map((o) => ({ ...o, type: sar.code }))],
    trades: Object.values(trades),
    locations,
    with: { steps: [draftStep, reviewStep], companies: [{ participantId: consultantId, name: consultant }] },
    owners: [],
  },
  columns: [
    { stageKey: "draft", shown: 1, lanes: [{ kind: "role", position: engineer, projectRole: contractor, count: 1, cards: [cards.draft] }] },
    {
      stageKey: "internal_review",
      shown: 3,
      lanes: [
        { kind: "role", position: engineer, projectRole: contractor, count: 2, cards: [cards.hvac, cards.fire] },
        { kind: "role", position: pm, projectRole: contractor, count: 1, cards: [cards.pool] },
      ],
    },
    {
      stageKey: "revise_resubmit",
      shown: 2,
      lanes: [
        { kind: "role", position: engineer, projectRole: contractor, count: 1, cards: [cards.r2] },
        { kind: "role", position: pm, projectRole: contractor, count: 1, cards: [cards.r3] },
      ],
    },
    {
      stageKey: "pending_approval",
      shown: 2,
      lanes: [{ kind: "company", participantId: consultantId, companyName: consultant, count: 2, cards: [cards.pending1, cards.pending2] }],
    },
    { stageKey: "approved", shown: 2, lanes: [{ kind: "closed", count: 2, cards: [cards.codeA, cards.codeB] }] },
    { stageKey: "rejected", shown: 1, lanes: [{ kind: "closed", count: 1, cards: [cards.codeD] }] },
    // Three cancelled items, all closed more than 30 days ago.
    { stageKey: "cancelled", shown: 0, lanes: [] },
  ],
  moves: {},
  layout: defaultBoardCardLayout,
};

// What Ahmed may do with "Fire Suppression System" now (RP-350): two Transitions
// lead to Pending Approval, so that Stage is no drop target.
const move = (transition: string, label: { en: string; ar: string }, kind: WorkItemMove["kind"], stageKey: string): WorkItemMove => ({
  transition,
  label,
  kind,
  stageKey,
  actionForm: null,
});
const sendBack = move("return", b("Return", "إعادة"), "return", "revise_resubmit");
const cancel = move("cancel", b("Cancel", "إلغاء"), "cancel", "cancelled");
const boardWithMoves: WorkItemBoardData = {
  ...board,
  moves: {
    [cards.fire.id]: [
      sendBack,
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
const cardOf = (context: PlayContext, row: WorkItemRow) =>
  context.canvasElement.querySelector<HTMLElement>(`a[href="#${row.id}"]`)!.closest<HTMLElement>("[data-kanban-card]")!;

/**
 * The board as the anatomy draws it: a column per Stage but Drafts (they stay
 * on the List and Need My Action), each with its dot, name and count; inside,
 * Al Futtaim's Steps as groups, the Consultant as one group by its name only
 * (V14), the closed items as "Mixed". Cards show the number left to right, the
 * Revision or Code badge in the left corner, the Trade in its hue, the plan
 * location and the owner; Code A turns its card green; 4+ weeks shows only its look.
 */
export const Wide: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.board) });
    const columns = within(region).getAllByRole("listitem").filter((li) => li.dataset.stage);
    await expect(columns.map((c) => c.dataset.stage)).toEqual(board.stages.filter((s) => s.category !== "draft").map((s) => s.key));
    await expect(context.canvasElement.querySelector(`a[href="#${cards.draft.id}"]`)).toBeNull();

    const internal = columnOf(context, stages.internal);
    const groups = within(internal).getAllByRole("region");
    // In the viewer's alphabetical order.
    // My own roles, in their Positions' order: Engineer, then Project Manager.
    await expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([engineerLane[locale], pmLane[locale]]);
    const pmGroup = groups[1]!;
    await expect(within(pmGroup).getByText(new RegExp(storyText(context, copy.notPickedUp)))).toBeVisible();

    const pending = columnOf(context, stages.pending);
    await expect(within(pending).getAllByRole("region").map((g) => g.getAttribute("aria-label"))).toEqual([consultant[locale]]);
    // Another Company: its name only, never a Step or a person.
    await expect(within(pending).queryByText(engineerLane[locale])).toBeNull();

    await expect(within(columnOf(context, stages.approved)).getByRole("region")).toHaveAccessibleName(storyText(context, copy.mixed));
    await expect(cardOf(context, cards.codeA)).toHaveAttribute("data-approved");
    await expect(cardOf(context, cards.codeB)).not.toHaveAttribute("data-approved");
    await expect(cardOf(context, cards.hvac)).toHaveAttribute("data-aged");
    await expect(cardOf(context, cards.hvac)).not.toHaveTextContent(/overdue|late|متأخر/i);
    // A closed card names who closed it: another Company by its name only (V14).
    await expect(cardOf(context, cards.codeA)).toHaveTextContent(consultant[locale]);
    // Latin initials and an English month, in Arabic too.
    await expect(cardOf(context, cards.hvac)).toHaveTextContent("AA");
    await expect(cardOf(context, cards.hvac)).toHaveTextContent("Jun 12");

    const r2 = cardOf(context, cards.r2);
    const number = within(r2).getByText("12789331");
    await expect(within(r2).queryByText(/Rev 2/)).toBeNull();
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
    // The badge in the left corner, in both languages.
    await expect(within(r2).getByText("R2").getBoundingClientRect().left).toBeLessThan(number.getBoundingClientRect().left);
    const approved = columnOf(context, stages.approved);
    await expect(approved.querySelectorAll("[data-outcome]")).toHaveLength(2);
    // The Review Code badge reads "Code A" in Arabic too, not a bare letter, whole badge left to right, with its icon (RP-522).
    const codeA = approved.querySelector<HTMLElement>('[data-outcome="A"]')!;
    await expect(codeA).toHaveTextContent("Code A");
    await expect(getComputedStyle(codeA).direction).toBe("ltr");
    await expect(codeA.querySelector("svg.tabler-icon-circle-check")).not.toBeNull();
    await expect(approved.querySelector('[data-outcome="B"] svg.tabler-icon-circle-check')).not.toBeNull();
    await expect(within(approved).queryByRole("img")).toBeNull();
  },
};

/** Columns run in the reading direction: right to left in Arabic. */
export const ColumnsRunInReadingOrder: Story = {
  play: async (context) => {
    const first = columnOf(context, stages.internal).getBoundingClientRect();
    const second = columnOf(context, stages.resubmitted).getBoundingClientRect();
    if (storyLocale(context) === "ar") await expect(second.right).toBeLessThanOrEqual(first.left);
    else await expect(second.left).toBeGreaterThanOrEqual(first.right);
  },
};

/** A group collapses from its chevron and opens again; its cards are hidden meanwhile. */
export const CollapsedGroup: Story = {
  play: async (context) => {
    const internal = columnOf(context, stages.internal);
    const toggle = within(internal).getByRole("button", { name: new RegExp(engineerLane[storyLocale(context)]) });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(within(internal).queryByRole("link", { name: cards.hvac.title })).toBeNull();
    await expect(within(internal).getByRole("link", { name: cards.pool.title })).toBeVisible();
  },
};

/** With the Contractor name switched on, and the plan location and date off (Card view layout). */
export const OtherLayout: Story = {
  args: { layout: { contractorName: true, location: false, creationDate: false } satisfies BoardCardLayout },
  play: async (context) => {
    const fire = cardOf(context, cards.fire);
    await expect(within(fire).getByText(ownCompany[storyLocale(context)])).toBeVisible();
    await expect(within(fire).queryByText(f5.name[storyLocale(context)])).toBeNull();
  },
};

/**
 * A closed column holds the last 30 days, with its total and "Show all",
 * which opens the List with the same filters and that Stage.
 */
export const ClosedColumns: Story = {
  args: { query: { ...defaults, trade: [trades.electrical.id], sort: "documentNumber" } },
  play: async (context) => {
    const approved = columnOf(context, stages.approved);
    await expect(within(approved).getByTestId("column-total")).toHaveTextContent("14");
    await expect(within(approved).getByRole("link", { name: new RegExp(storyText(context, stages.approved.name)) })).toHaveAttribute(
      "href",
      `?stage=approved&trade=${trades.electrical.id}&sort=documentNumber`,
    );
    const cancelled = columnOf(context, stages.cancelled);
    await expect(within(cancelled).getByText(storyText(context, copy.empty))).toBeVisible();
    await expect(within(cancelled).getByTestId("column-total")).toHaveTextContent("3");
  },
};

/**
 * Under a search, a closed column gives no total: a search counts only what it
 * shows. "Show all" still opens the List with the same search and that Stage.
 */
export const ClosedColumnsUnderSearch: Story = {
  args: { query: { ...defaults, q: "busbar" } },
  play: async (context) => {
    for (const stage of [stages.approved, stages.cancelled]) {
      const column = columnOf(context, stage);
      await expect(within(column).queryByTestId("column-total")).toBeNull();
      await expect(within(column).getByRole("link", { name: new RegExp(storyText(context, stage.name)) })).toHaveAttribute(
        "href",
        `?stage=${stage.key}&q=busbar`,
      );
    }
  },
};

/** Narrow: the board scrolls sideways in its own region; every card's link is a 44px touch target. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.board) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    for (const link of within(columnOf(context, stages.pending)).getAllByRole("link")) await expectTouchTarget(link);
  },
};

// A Stage with many cards: the column holds them under its fixed header.
const manyCards = Array.from({ length: 14 }, (_, i) => card(50 + i, { title: `Cable ladder section ${i + 1}`, stage: stages.pending, stepAgeWeeks: (i % 4) + 1, with: withConsultant }));
const crowded: WorkItemBoardData = {
  ...board,
  stages: board.stages.map((s) => (s.key === "pending_approval" ? { ...s, count: manyCards.length } : s)),
  columns: board.columns.map((c) =>
    c.stageKey === "pending_approval"
      ? { ...c, shown: manyCards.length, lanes: [{ kind: "company" as const, participantId: consultantId, companyName: consultant, count: manyCards.length, cards: manyCards }] }
      : c,
  ),
};

/**
 * A column with many cards grows with them, as the anatomy draws it: no inner
 * scroll, the page scrolls down. The board scrolls sideways in its own region
 * and the page never does (Epic RP-405, decision 7).
 */
export const ColumnsGrowWithTheirCards: Story = {
  args: { board: crowded },
  play: async (context) => {
    const column = columnOf(context, stages.pending);
    const inner = [...column.querySelectorAll<HTMLElement>("*")].filter((d) => ["auto", "scroll"].includes(getComputedStyle(d).overflowY));
    await expect(inner).toEqual([]);
    const cardsHeight = [...column.querySelectorAll("[data-kanban-card]")].reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
    await expect(column.getBoundingClientRect().height).toBeGreaterThan(cardsHeight);
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.board) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};

const movableCard = (context: PlayContext) => context.canvas.getAllByRole("listitem").find((li) => li.hasAttribute("data-movable"))!;
const dragData = () => ({ dataTransfer: new DataTransfer() });
const targetColumns = (context: PlayContext) =>
  context.canvas.getAllByRole("listitem").filter((li) => li.dataset.stage && li.hasAttribute("data-drop-target")).map((li) => li.dataset.stage);

/**
 * Dragging a card the viewer may act on rings it in tomato and outlines only the
 * Stages one of its Transitions alone leads to (the one under the card solid):
 * Pending Approval, which two lead to, is not one. Dropping on a target opens
 * that Transition's Action Form (here, `onMove`); dropping elsewhere does
 * nothing. Left mid-drag, over a target, for the screenshot.
 */
export const DraggingWithTargets: Story = {
  args: { board: boardWithMoves, onMove: fn() },
  play: async (context) => {
    const onMove = context.args.onMove as ReturnType<typeof fn>;
    const item = movableCard(context);
    await expect(item).toHaveAttribute("draggable", "true");
    await expect(context.canvas.getAllByRole("listitem").filter((li) => li.hasAttribute("data-movable"))).toHaveLength(1);
    await expect(targetColumns(context)).toEqual([]);

    fireEvent.dragStart(item, dragData());
    await waitFor(() => expect(targetColumns(context)).toEqual(["revise_resubmit", "cancelled"]));
    await expect(item.querySelector("[data-kanban-card]")).toHaveClass("ring-2");

    fireEvent.drop(columnOf(context, stages.pending), dragData());
    fireEvent.drop(columnOf(context, stages.internal), dragData());
    await expect(onMove).not.toHaveBeenCalled();

    fireEvent.drop(columnOf(context, stages.resubmitted), dragData());
    await expect(onMove).toHaveBeenCalledWith(cards.fire, sendBack);
    await waitFor(() => expect(targetColumns(context)).toEqual([]));

    // Left dragging again, over Revised & Resubmitted, for the screenshot.
    fireEvent.dragStart(item, dragData());
    fireEvent.dragOver(columnOf(context, stages.resubmitted), dragData());
    await waitFor(() => expect(columnOf(context, stages.resubmitted)).toHaveAttribute("data-drop-over"));
  },
};

/** Dragging on a phone: the board scrolls sideways, the targets are still outlined. */
export const DraggingNarrow: Story = { ...DraggingWithTargets, parameters: phone, play: undefined };

/** The same moves from the card's Move menu, for the keyboard, screen readers and touch: no drag needed. */
export const MovingFromTheMenu: Story = {
  args: { board: boardWithMoves, onMove: fn() },
  play: async (context) => {
    const onMove = context.args.onMove as ReturnType<typeof fn>;
    const name = storyText(context, copy.moveItem).replace("#", cards.fire.title);
    const trigger = within(movableCard(context)).getByRole("button", { name });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("dialog", { name });
    const locale = storyLocale(context);
    await expect(within(menu).getAllByRole("button").map((c) => c.textContent)).toEqual([
      `${sendBack.label[locale]}${storyText(context, copy.moveTo).replace("#", stages.resubmitted.name[locale])}`,
      `${cancel.label[locale]}${storyText(context, copy.moveTo).replace("#", stages.cancelled.name[locale])}`,
    ]);
    await userEvent.keyboard("{Tab}{Enter}");
    await expect(onMove).toHaveBeenCalledWith(cards.fire, cancel);
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

/** The toolbar the List shares, the Card view layout menu and the Kanban / List switch, as the Submittals tab shows it. */
function Toolbar({ args, locale }: { args: Story["args"]; locale: "en" | "ar" }) {
  const [layout, setLayout] = useState<BoardCardLayout>(defaultBoardCardLayout);
  const data = args?.board ?? board;
  return (
    <WorkItemList
      list={{ ...data, items: [], nextCursor: null }}
      query={args?.query ?? defaults}
      locale={locale}
      labels={workItemListLabels[locale]}
      hrefFor={listHrefFor}
      itemHref={(id) => `#${id}`}
      onQueryChange={fn()}
      action={
        <a href="#new" className="inline-flex h-[42px] items-center rounded-sm bg-primary px-3.5 text-sm font-semibold text-on-primary pointer-coarse:min-h-11">
          {locale === "en" ? "+ Add Submittal" : "+ إضافة اعتماد"}
        </a>
      }
      viewSwitch={
        <>
          <BoardLayoutMenu
            layout={layout}
            onChange={(c) => setLayout((l) => ({ ...l, ...c }))}
            labels={boardLayoutMenuLabels[locale]}
            board={data}
            boardLabels={workItemBoardLabels[locale]}
            locale={locale}
          />
          <WorkItemViewSwitch view="kanban" labels={viewSwitchLabels[locale]} hrefFor={(v) => (v === "kanban" ? "?view=kanban" : "?")} />
        </>
      }
      board={
        <WorkItemBoard
          board={data}
          query={args?.query ?? defaults}
          locale={locale}
          labels={workItemBoardLabels[locale]}
          layout={layout}
          listHrefFor={listHrefFor}
          itemHref={(id) => `#${id}`}
        />
      }
    />
  );
}

export const WithToolbar: Story = {
  render: (args, context) => <Toolbar args={args} locale={storyLocale(context)} />,
  play: async (context) => {
    const views = context.canvas.getByRole("navigation", { name: storyText(context, copy.view) });
    await expect(within(views).getByRole("link", { name: storyText(context, copy.kanban) })).toHaveAttribute("aria-current", "page");
    await expect(context.canvas.getByRole("button", { name: workItemListLabels[storyLocale(context)].filters })).toBeVisible();
    await expect(context.canvas.getByRole("searchbox")).toHaveAttribute("placeholder", workItemListLabels[storyLocale(context)].searchPlaceholderBoard);
    await expect(context.canvas.queryByRole("table")).toBeNull();
  },
};

/** The Card view layout menu: Header, Subject, tags and owner always shown; the Contractor name switched on, previewed live. */
export const CardViewLayoutMenu: Story = {
  parameters: { overlay: true },
  render: (args, context) => <Toolbar args={args} locale={storyLocale(context)} />,
  play: async (context) => {
    const labels = boardLayoutMenuLabels[storyLocale(context)];
    await userEvent.click(context.canvas.getByRole("button", { name: labels.title }));
    const menu = await screen.findByRole("dialog", { name: labels.title });
    const contractor = within(menu).getByRole("switch", { name: labels.contractorName });
    await expect(contractor).not.toBeChecked();
    await expect(within(menu).getByRole("switch", { name: labels.location })).toBeChecked();
    await userEvent.click(contractor);
    await expect(contractor).toBeChecked();
    // The board and the preview both show it at once.
    await expect(within(cardOf(context, cards.hvac)).getByText(ownCompany[storyLocale(context)])).toBeVisible();
    await expect(within(menu).getByText(ownCompany[storyLocale(context)])).toBeVisible();
  },
};

/** The filter panel open over the board, two fields filtered: Stage (two values) and Trade. */
export const FilterPanelOpen: Story = {
  parameters: { overlay: true },
  args: { query: { ...defaults, stage: ["internal_review", "pending_approval"], trade: [trades.electrical.id] } },
  render: (args, context) => <Toolbar args={args} locale={storyLocale(context)} />,
  play: async (context) => {
    const labels = workItemListLabels[storyLocale(context)];
    await userEvent.click(context.canvas.getByRole("button", { name: new RegExp(`^${labels.filters}`) }));
    const panel = await screen.findByRole("dialog", { name: labels.filters });
    await expect(within(panel).getByText(labels.filtersApplied("2", 2))).toBeVisible();
    // The Kanban's Stage field has no Drafts.
    await expect(within(panel).queryByRole("checkbox", { name: stages.draft.name[storyLocale(context)] })).toBeNull();
    await expect(within(panel).getByRole("checkbox", { name: stages.internal.name[storyLocale(context)] })).toBeChecked();
  },
};

/** The toolbar and the board on a phone. */
export const WithToolbarNarrow: Story = { ...WithToolbar, parameters: phone, play: undefined };
