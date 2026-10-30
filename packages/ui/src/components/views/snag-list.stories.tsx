import { workItemQuery, workItemSearchParams, type Locale, type WorkItemBoard as WorkItemBoardData, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { expectFillsTheWindow } from "../../storybook/fills-window.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { StoryProjectPage } from "../../storybook/shell.tsx";
import type { SnagBulkLabels } from "./snag-bulk.tsx";
import type { SnagExportLabels } from "./snag-export.ts";
import { SnagList, type SnagBulk, type SnagListLabels, type SnagListProps } from "./snag-list.tsx";
import type { SnagSwipe } from "./snag-phone.tsx";
import type { SwipeAction } from "./snag-swipe.ts";

// The Snag List's desktop views (RP-94, design/reference/claude-design/ui_kits/app/snag-list.html)
// as TMC's PM sees them: Snags raised by the Consultant on TMC, and Comments raised from
// a Code B submittal. Story data only.
const b = (en: string, ar: string) => ({ en, ar });

const labels: Record<Locale, SnagListLabels> = {
  en: {
    toolbar: "Filters and sort",
    search: "Search",
    searchPlaceholder: "Search number or Subject",
    searchHelp: "Searches Document Number and Subject",
    filters: "Filter",
    clearAll: "Clear all",
    done: "Done",
    close: "Close",
    filtersApplied: (n, count) => (count === 0 ? "No filters applied" : count === 1 ? "1 filter applied" : `${n} filters applied`),
    clear: "Clear",
    clearField: "Clear",
    searchValues: "Search",
    noMatches: "No matches",
    needMyAction: "Need My Action",
    newItem: "New",
    newOfType: (type) => `New ${type}`,
    types: "Types",
    allTypes: "All",
    stage: "Stage",
    trade: "Trade",
    company: "Company",
    raisedFrom: "Raised from",
    level: (n) => `Level ${n}`,
    raisedManually: "By hand",
    table: "Snag List",
    columns: {
      documentNumber: "Document Number",
      subject: "Subject",
      type: "Type",
      trade: "Trade",
      location: "Location",
      raisedFrom: "Raised from",
      with: "With",
      stepAge: "Step Age",
      photo: "Photo",
    },
    items: (n, count) => (count === 1 ? "1 item" : `${n} items`),
    hideGroup: (stage) => `Hide ${stage}`,
    showGroup: (stage) => `Show ${stage}`,
    noNumber: "No number yet",
    notPickedUp: "Not picked up",
    code: (code) => `Code ${code}`,
    photoOf: (subject) => `Photo of ${subject}`,
    board: "Kanban",
    noItems: "Nothing here",
    emptyTitle: "No snags. Nice work.",
    emptyBody: "Snags and Comments appear here when they are raised on site, from failed inspections or from Code B reviews.",
    noMatchTitle: "Nothing you can see matches these filters",
    noSearchMatchTitle: "Nothing you can see matches this search",
    clearFilters: "Clear filters",
    pages: "Pages",
    rowsPerPage: "Rows per page",
    firstPage: "First page",
    previousPage: "Previous page",
    nextPage: "Next page",
    lastPage: "Last page",
    page: (page) => `Page ${page}`,
    pageOf: (page, last) => `Page ${page} of ${last}`,
    phone: {
      swipeHint: "Swipe a card for what you can do on it",
      showItems: (n, count) => (count === 1 ? "Show 1 item" : `Show ${n} items`),
      transitionsOf: (subject) => `What you can do on ${subject}`,
      loadingTransitions: "Loading…",
      noTransitions: "Nothing for you to do here now",
      transitionsUnavailable: "Couldn't read what you can do on it",
    },
  },
  ar: {
    toolbar: "التصفية والترتيب",
    search: "بحث",
    searchPlaceholder: "ابحث بالرقم أو الموضوع",
    searchHelp: "يبحث في رقم المستند والموضوع",
    filters: "التصفية",
    clearAll: "مسح الكل",
    done: "تم",
    close: "إغلاق",
    filtersApplied: (n, count) => (count === 0 ? "لا تصفية مطبقة" : `${n} تصفية مطبقة`),
    clear: "مسح",
    clearField: "مسح",
    searchValues: "بحث",
    noMatches: "لا نتائج",
    needMyAction: "بحاجة لإجرائي",
    newItem: "جديد",
    newOfType: (type) => `إضافة ${type}`,
    types: "الأنواع",
    allTypes: "الكل",
    stage: "المرحلة",
    trade: "التخصص",
    company: "الشركة",
    raisedFrom: "المصدر",
    level: (n) => `المستوى ${n}`,
    raisedManually: "يدويًا",
    table: "قائمة الملاحظات",
    columns: {
      documentNumber: "رقم المستند",
      subject: "الموضوع",
      type: "النوع",
      trade: "التخصص",
      location: "الموقع",
      raisedFrom: "المصدر",
      with: "لدى",
      stepAge: "عمر الخطوة",
      photo: "صورة",
    },
    items: (n) => `${n} عنصر`,
    hideGroup: (stage) => `إخفاء ${stage}`,
    showGroup: (stage) => `إظهار ${stage}`,
    noNumber: "بلا رقم بعد",
    notPickedUp: "لم تُستلَم",
    code: (code) => `Code ${code}`,
    photoOf: (subject) => `صورة ${subject}`,
    board: "كانبان",
    noItems: "لا شيء هنا",
    emptyTitle: "لا توجد ملاحظات. عمل رائع.",
    emptyBody: "تظهر الملاحظات والتعليقات هنا عند تسجيلها في الموقع أو من الفحوصات الراسبة أو من مراجعات Code B.",
    noMatchTitle: "لا شيء مما تراه يطابق هذه التصفية",
    noSearchMatchTitle: "لا شيء مما تراه يطابق هذا البحث",
    clearFilters: "مسح التصفية",
    pages: "الصفحات",
    rowsPerPage: "صفوف لكل صفحة",
    firstPage: "الصفحة الأولى",
    previousPage: "الصفحة السابقة",
    nextPage: "الصفحة التالية",
    lastPage: "الصفحة الأخيرة",
    page: (page) => `صفحة ${page}`,
    pageOf: (page, last) => `صفحة ${page} من ${last}`,
    phone: {
      swipeHint: "اسحب البطاقة لترى ما يمكنك فعله عليها",
      showItems: (n, count) => (count === 1 ? "عرض عنصر واحد" : `عرض ${n} عنصر`),
      transitionsOf: (subject) => `ما يمكنك فعله على ${subject}`,
      loadingTransitions: "جارٍ التحميل…",
      noTransitions: "لا إجراء لك عليها الآن",
      transitionsUnavailable: "تعذّرت قراءة ما يمكنك فعله عليها",
    },
  },
};

const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  open: { key: "open", name: b("Open", "مفتوحة"), category: "in_progress" as const },
  inProgress: { key: "in_progress", name: b("In Progress", "قيد التنفيذ"), category: "in_progress" as const },
  onHold: { key: "on_hold", name: b("On Hold", "معلّقة"), category: "in_progress" as const },
  resolved: { key: "resolved", name: b("Resolved", "تمت معالجتها"), category: "in_progress" as const },
  closed: { key: "closed", name: b("Closed", "مغلقة"), category: "closed_positive" as const },
};
const snag = { code: "SNG", name: b("Snag", "عيب") };
const comment = { code: "CMT", name: b("Comment", "ملاحظة") };
// A Project's own Type: a neutral chip, with no change to the views.
const walkdown = { code: "WLK", name: b("Walkdown item", "بند جولة") };
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical", "الكهرباء") };
const finishes = { id: "00000000-0000-4000-8000-0000000000e2", code: "AR", name: b("Finishes", "التشطيبات") };
const tower = { id: "00000000-0000-4000-8000-0000000000a1", code: "T1", name: b("Tower 1", "البرج 1") };
const floor2 = { id: "00000000-0000-4000-8000-0000000000a2", code: "F02", name: b("Floor 02", "الطابق 02") };
const tmc = b("TMC Constructions", "تي إم سي للإنشاءات");
const consultant = b("Design Consultants LLC", "المصممون الاستشاريون");
const tmcId = "00000000-0000-4000-8000-0000000000c1";
const dclId = "00000000-0000-4000-8000-0000000000c2";
const mar041 = "TWR-TMC-EL-MAR-041";

const row = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: snag,
  title: "",
  documentNumber: `TWR-DCL-EL-SNG-01${n}`,
  revisionNo: 0,
  stage: stages.open,
  trade: electrical,
  location: floor2,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  with: { kind: "own", companyName: tmc, step: { key: "open", name: b("Open", "مفتوحة") }, holder: null },
  submissionDate: "2026-09-01T00:00:00.000Z",
  creationDate: null,
  raisedFrom: null,
  photo: null,
  ...rest,
});

const items: WorkItemRow[] = [
  row(1, { title: "Cable tray not bonded", stepAgeWeeks: 3, photo: { documentId: "00000000-0000-4000-8000-0000000000f1", contentType: "image/jpeg" } }),
  row(2, {
    title: "Update luminaire schedule to Rev C",
    type: comment,
    documentNumber: "TWR-DCL-EL-CMT-003",
    stepAgeWeeks: 2,
    raisedFrom: { documentNumber: mar041, subject: "Lighting fixtures", workItemId: "00000000-0000-4000-8000-0000000000b1", outcome: { code: "B", name: b("Approved with Comments", "معتمد مع ملاحظات"), look: "b" } },
  }),
  row(3, {
    title: "Socket outlet loose",
    stage: stages.inProgress,
    with: { kind: "own", companyName: tmc, step: { key: "in_progress", name: b("In Progress", "قيد التنفيذ") }, holder: { name: b("Ali Sonour", "علي سنور"), isMe: true } },
  }),
  row(4, {
    title: "Ceiling plasterboard rework",
    trade: finishes,
    type: walkdown,
    documentNumber: "TWR-DCL-AR-WLK-002",
    stage: stages.onHold,
    stepAgeWeeks: 4,
    // Raised from an item TMC doesn't see: its number and Subject only, no link, no Code (E1).
    raisedFrom: { documentNumber: "TWR-DCL-AR-IR-045", subject: "Ceiling inspection", workItemId: null, outcome: null },
  }),
  row(5, { title: "Provide IP65 certificate", type: comment, documentNumber: "TWR-DCL-EL-CMT-001", stage: stages.resolved, with: { kind: "company", companyName: consultant } }),
  row(6, { title: "Emergency lighting duration", type: comment, documentNumber: "TWR-DCL-EL-CMT-002", stage: stages.closed, with: null, closedBy: { kind: "company", companyName: consultant } }),
];

const filters: WorkItemListData["filters"] = {
  types: [comment, snag, walkdown],
  outcomes: [],
  trades: [electrical, finishes],
  locations: [
    { ...tower, parentId: null, depth: 1, levelName: b("Building", "المبنى") },
    { ...floor2, parentId: tower.id, depth: 2, levelName: b("Floor", "الطابق") },
  ],
  with: { steps: [], companies: [{ participantId: dclId, name: consultant }] },
  owners: [],
  companies: [
    { participantId: tmcId, name: tmc, own: true },
    { participantId: dclId, name: consultant, own: false },
  ],
  raisedFrom: [{ documentNumber: mar041, subject: "Lighting fixtures" }],
};
const counts = (of: WorkItemRow[]) => Object.values(stages).map((s) => ({ ...s, count: of.filter((i) => i.stage.key === s.key).length }));
const list: WorkItemListData = {
  stages: counts(items),
  items,
  nextCursor: null,
  page: { number: 1, size: 25, hasNext: false },
  typeCounts: [
    { code: "CMT", count: 3 },
    { code: "SNG", count: 2 },
    { code: "WLK", count: 1 },
  ],
  filters,
};
const board: WorkItemBoardData = {
  stages: list.stages,
  filters,
  typeCounts: list.typeCounts,
  columns: list.stages.map((s) => {
    const cards = items.filter((i) => i.stage.key === s.key);
    return { stageKey: s.key, shown: cards.length, steps: [], lanes: cards.length ? [{ kind: "company" as const, participantId: tmcId, companyName: tmc, count: cards.length, cards }] : [] };
  }),
  moves: {},
  layout: { contractorName: false, location: true, creationDate: true },
};

const defaults: WorkItemQuery = { ...workItemQuery.parse({}), module: "snag_list", sort: "stage", page: 1, pageSize: 25 };

const meta = {
  title: "Views/SnagList",
  component: SnagList,
  args: {
    data: { view: "list", list },
    query: defaults,
    locale: "en",
    labels: labels.en,
    hrefFor: (q: WorkItemQuery) => `?${workItemSearchParams(q)}`,
    itemHref: (id: string) => `#${id}`,
    onQueryChange: fn<SnagListProps["onQueryChange"]>(),
    newTypes: [snag],
    newHref: (code: string) => `#new-${code}`,
    photoUrls: {},
  },
  render: (args, context) => <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />,
} satisfies Meta<typeof SnagList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The List: the rows under a header per Stage with its count, a type chip of a shape and a
 * colour, "Raised from" a linked number with its Code (or by hand), Step Age dots for an open
 * item only. Document Numbers read left to right, in Arabic too.
 */
export const List: Story = {
  play: async (context) => {
    const table = context.canvas.getByRole("table", { name: labels[storyLocale(context)].table });
    for (const s of ["open", "inProgress", "onHold", "resolved", "closed"] as const) {
      await expect(within(table).getByRole("button", { name: labels[storyLocale(context)].hideGroup(stages[s].name[storyLocale(context)]) })).toBeVisible();
    }
    const source = within(table).getByRole("link", { name: mar041 });
    await expect(source).toHaveAttribute("href", "#00000000-0000-4000-8000-0000000000b1");
    await expect(source.parentElement!.querySelector('[data-outcome="B"]')).toHaveTextContent("Code B");
    // A source the viewer doesn't see: its number, never a link (E1).
    await expect(within(table).queryByRole("link", { name: "TWR-DCL-AR-IR-045" })).toBeNull();
    await expect(within(table).getByText("TWR-DCL-AR-IR-045")).toBeVisible();
    const number = within(table).getByText("TWR-DCL-EL-SNG-011");
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
  },
};

/** A Stage's group folds and opens again. */
export const FoldingAGroup: Story = {
  play: async (context) => {
    const name = stages.open.name[storyLocale(context)];
    await userEvent.click(context.canvas.getByRole("button", { name: labels[storyLocale(context)].hideGroup(name) }));
    await expect(context.canvas.queryByRole("link", { name: "Cable tray not bonded" })).toBeNull();
    await userEvent.click(context.canvas.getByRole("button", { name: labels[storyLocale(context)].showGroup(name) }));
    await expect(context.canvas.getByRole("link", { name: "Cable tray not bonded" })).toBeVisible();
  },
};

/** The type chips: All and each of the Module's Types, a Project's own included, each with its count; one chosen lists that Type. */
export const TypeChips: Story = {
  args: { query: { ...defaults, type: ["SNG"] } },
  play: async (context) => {
    const chips = context.canvas.getByRole("navigation", { name: labels[storyLocale(context)].types });
    const links = within(chips).getAllByRole("link");
    await expect(links).toHaveLength(4);
    await expect(links[0]).toHaveTextContent("6");
    const chosen = within(chips).getByRole("link", { current: true });
    await expect(chosen).toHaveTextContent(snag.name[storyLocale(context)]);
    await expect(links[0]!.getAttribute("href")).not.toContain("type=");
    await expect(within(chips).getByRole("link", { name: new RegExp(walkdown.name[storyLocale(context)]) })).toHaveAttribute("href", expect.stringContaining("type=WLK"));
  },
};

/** "+ New" with several Types to raise is a menu of them; with none it is left out. */
export const NewMenu: Story = {
  args: { newTypes: [comment, snag] },
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: labels[storyLocale(context)].newItem }));
    await expect(await within(document.body).findByRole("link", { name: snag.name[storyLocale(context)] })).toHaveAttribute("href", "#new-SNG");
  },
};

export const NothingToRaise: Story = {
  args: { newTypes: [] },
  play: async (context) => {
    await expect(context.canvas.queryByRole("link", { name: /New|إضافة/ })).toBeNull();
  },
};

export const Kanban: Story = {
  args: { data: { view: "kanban", board } },
  play: async (context) => {
    const kanban = context.canvas.getByRole("region", { name: labels[storyLocale(context)].board });
    // Drafts have no column, as on every board.
    await expect(within(kanban).queryByRole("region", { name: stages.draft.name[storyLocale(context)] })).toBeNull();
    const open = within(kanban).getByRole("region", { name: stages.open.name[storyLocale(context)] });
    await expect(within(open).getAllByRole("listitem")).toHaveLength(2);
  },
};

// Twelve open snags: a column taller than the window.
const manyOpen = Array.from({ length: 12 }, (_, i) => row(7 + i, { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, title: `Cable tray not bonded, bay ${i + 1}`, documentNumber: `TWR-DCL-EL-SNG-1${String(i).padStart(2, "0")}` }));
const crowdedItems = [...items, ...manyOpen];
const crowded: WorkItemBoardData = {
  ...board,
  stages: counts(crowdedItems),
  columns: counts(crowdedItems).map((s) => {
    const cards = crowdedItems.filter((i) => i.stage.key === s.key);
    return { stageKey: s.key, shown: cards.length, steps: [], lanes: cards.length ? [{ kind: "company" as const, participantId: tmcId, companyName: tmc, count: cards.length, cards }] : [] };
  }),
};

/**
 * On its page (RP-1092), the Kanban fills the window from under its type chips to the bottom
 * edge, as the Submittals' does: its sideways scrollbar sits on that edge, it scrolls down
 * inside itself, and the page doesn't scroll.
 */
export const KanbanFillsTheWindow: Story = {
  parameters: { ...overlay, layout: "fullscreen" },
  args: { data: { view: "kanban", board: crowded } },
  render: (args, context) => (
    <StoryProjectPage context={context} current="snag_list">
      <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />
    </StoryProjectPage>
  ),
  play: async (context) => {
    const locale = storyLocale(context);
    const region = context.canvas.getByRole("region", { name: labels[locale].board });
    await expectFillsTheWindow(region, context.canvas.getByRole("navigation", { name: labels[locale].types }));
    // A short column still reaches the board's foot; a tall one grows past it.
    const open = within(region).getByRole("region", { name: stages.open.name[locale] });
    const closed = within(region).getByRole("region", { name: stages.closed.name[locale] });
    await expect(open.scrollHeight).toBe(open.clientHeight);
    await expect(closed.getBoundingClientRect().height).toBeGreaterThanOrEqual(region.clientHeight - 8);
  },
};

/** Nothing the viewer sees at all. */
export const Empty: Story = {
  args: { data: { view: "list", list: { ...list, items: [], stages: counts([]), typeCounts: [] } } },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, b("No snags. Nice work.", "لا توجد ملاحظات. عمل رائع.")))).toBeVisible();
  },
};

/** Filters that match nothing the viewer sees: a way back. */
export const NothingMatches: Story = {
  args: { query: { ...defaults, stage: ["on_hold"], company: [dclId] }, data: { view: "list", list: { ...list, items: [], stages: counts([]), typeCounts: [] } } },
  play: async (context) => {
    await expect(context.canvas.getByRole("link", { name: labels[storyLocale(context)].clearFilters })).toBeVisible();
  },
};

/** The bulk bar's and dialogs' words (RP-629). */
const bulkLabels: Record<Locale, SnagBulkLabels> = {
  en: {
    selected: (n, count) => (count === 1 ? "1 selected" : `${n} selected`),
    clearSelection: "Clear selection",
    selectAll: "Select all on this page",
    selectRow: (subject) => `Select ${subject}`,
    reassign: "Reassign",
    moveStage: "Move Stage",
    exportSelected: "Export selected",
    exportAll: "Export to Excel",
    exported: (n, count) => (count === 1 ? "Exported 1 item (Excel)" : `Exported ${n} items (Excel)`),
    exportedCapped: (n) => `Exported the first ${n} items (Excel)`,
    exportFailed: "The export could not be made. Try again.",
    close: "Close",
    cancel: "Cancel",
    working: "Working…",
    reassignTitle: "Reassign within your Company",
    reassignDescription: (n, count) => (count === 1 ? "Hand the item to a colleague." : `Hand the ${n} chosen items to a colleague.`),
    reassignTo: "Hand over to",
    colleague: (name, n, of) => `${name} (${n} of ${of})`,
    nothingToReassign: "Your Company holds none of these items, or you can't reassign them.",
    reassignConfirm: "Reassign",
    moveTitle: "Move Stage",
    moveDescription: (n, count) => (count === 1 ? "Move the item to a Stage." : `Move the ${n} chosen items to a Stage.`),
    moveTo: "Move to",
    moveHint: "Each move is signed and recorded as if you took it on the item's page.",
    moveConfirm: "Move",
    doneCount: (n, count) => (count === 1 ? "1 item done" : `${n} items done`),
    skippedCount: (n, count) => (count === 1 ? "1 item skipped" : `${n} items skipped`),
    reasons: {
      not_found: "You can no longer see it",
      not_offered: "Not offered to you for this item",
      needs_input: "Needs a note or a choice: do it on the item's page",
      already_there: "Already at this Stage",
      refused: "Its rules don't allow it now",
      item_closed: "It is closed",
    },
    unseen: (n, count) => (count === 1 ? "1 item you can no longer see" : `${n} items you can no longer see`),
    failed: "That didn't work. Try again.",
  },
  ar: {
    selected: (n) => `${n} محدد`,
    clearSelection: "مسح التحديد",
    selectAll: "تحديد الكل في هذه الصفحة",
    selectRow: (subject) => `تحديد ${subject}`,
    reassign: "إعادة إسناد",
    moveStage: "نقل المرحلة",
    exportSelected: "تصدير المحدد",
    exportAll: "تصدير إلى Excel",
    exported: (n) => `تم تصدير ${n} عنصر (Excel)`,
    exportedCapped: (n) => `تم تصدير أول ${n} عنصر (Excel)`,
    exportFailed: "تعذّر إنشاء الملف. حاول مرة أخرى.",
    close: "إغلاق",
    cancel: "إلغاء",
    working: "جارٍ التنفيذ…",
    reassignTitle: "إعادة الإسناد داخل شركتك",
    reassignDescription: (n) => `سلّم العناصر المحددة (${n}) إلى زميل.`,
    reassignTo: "تسليم إلى",
    colleague: (name, n, of) => `${name} (${n} من ${of})`,
    nothingToReassign: "لا تحتفظ شركتك بأي من هذه العناصر، أو لا يمكنك إعادة إسنادها.",
    reassignConfirm: "إعادة إسناد",
    moveTitle: "نقل المرحلة",
    moveDescription: (n) => `انقل العناصر المحددة (${n}) إلى مرحلة.`,
    moveTo: "النقل إلى",
    moveHint: "يُوقَّع كل نقل ويُسجَّل كما لو أجريته من صفحة العنصر.",
    moveConfirm: "نقل",
    doneCount: (n) => `تم تنفيذ ${n} عنصر`,
    skippedCount: (n) => `تم تخطي ${n} عنصر`,
    reasons: {
      not_found: "لم يعد ظاهرًا لك",
      not_offered: "غير متاح لك لهذا العنصر",
      needs_input: "يحتاج إلى ملاحظة أو اختيار: نفّذه من صفحة العنصر",
      already_there: "في هذه المرحلة بالفعل",
      refused: "قواعده لا تسمح به الآن",
      item_closed: "العنصر مغلق",
    },
    unseen: (n) => `${n} عنصر لم يعد ظاهرًا لك`,
    failed: "لم تنجح العملية. حاول مرة أخرى.",
  },
};

const exportLabels: Record<Locale, SnagExportLabels> = {
  en: { documentNumber: "Document Number", subject: "Subject", type: "Type", trade: "Trade", location: "Location", stage: "Stage", raisedFrom: "Raised from", with: "With", stepAgeWeeks: "Step Age (weeks)", raisedManually: "By hand", notPickedUp: "Not picked up", noNumber: "No number yet", fileName: "Snag List" },
  ar: { documentNumber: "رقم المستند", subject: "الموضوع", type: "النوع", trade: "التخصص", location: "الموقع", stage: "المرحلة", raisedFrom: "المصدر", with: "لدى", stepAgeWeeks: "عمر الخطوة (بالأسابيع)", raisedManually: "يدويًا", notPickedUp: "لم تُستلَم", noNumber: "بلا رقم بعد", fileName: "قائمة الملاحظات" },
};

const ali = { memberId: "00000000-0000-4000-8000-0000000000d1", name: b("Ali Sonour", "علي سنور") };
const khalid = { memberId: "00000000-0000-4000-8000-0000000000d2", name: b("Khalid Bakr", "خالد بكر") };

const reportLabels: Record<Locale, SnagBulk["report"]["labels"]> = {
  en: { exportPdf: "Export PDF", preparing: "Preparing the PDF…", download: (n) => `Download the Snag List PDF (${n} items)`, failed: "The PDF could not be made. Try again.",
    gone: "No longer available: it holds items you can no longer see. Ask for a new one.",
  },
  ar: {
    exportPdf: "تصدير PDF",
    preparing: "جارٍ إعداد ملف PDF…",
    download: (n) => `تنزيل قائمة الملاحظات PDF (${n} عنصر)`,
    failed: "تعذّر إعداد ملف PDF. حاول مرة أخرى.",
    gone: "لم يعد متاحًا: فيه عناصر لم تعد تراها. اطلب تقريرًا جديدًا.",
  },
};

const reportId = "00000000-0000-4000-8000-0000000000e1";

const bulkFor = (locale: Locale, actions: Partial<SnagBulk["actions"]> = {}): SnagBulk => ({
  actions: {
    labels: bulkLabels[locale],
    candidates: async (ids) => ({ reassignable: ids.length, members: [{ ...ali, items: ids.length }, { ...khalid, items: Math.max(1, ids.length - 1) }] }),
    reassign: async (ids) => ({ done: ids, skipped: [] }),
    move: async (ids) => ({ done: ids.slice(0, 1), skipped: ids.slice(1).map((id) => ({ id, documentNumber: "TWR-DCL-EL-SNG-011", title: "Cable tray not bonded", reason: "not_offered" as const })) }),
    onChanged: fn(),
    ...actions,
  },
  exportLabels: exportLabels[locale],
  loadExportRows: async () => ({ items: items.slice(0, 3), capped: false }),
  report: {
    labels: reportLabels[locale],
    request: async (ids) => ({ id: reportId, status: "preparing", url: null, count: ids?.length ?? 3 }),
    check: async () => ({ id: reportId, status: "ready", url: "#", count: null }),
  },
});

/** "Export PDF" on the bar: the worker makes the Snag report, the line says so, then links to it (RP-677). */
export const ExportPdf: Story = {
  render: (args, context) => (
    <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} bulk={bulkFor(storyLocale(context))} />
  ),
  play: async (context) => {
    const text = bulkLabels[storyLocale(context)];
    const pdf = reportLabels[storyLocale(context)];
    const table = context.canvas.getByRole("table", { name: labels[storyLocale(context)].table });
    await userEvent.click(within(table).getByRole("checkbox", { name: text.selectRow("Cable tray not bonded") }));
    // The toolbar has one too (every row the filters match); the bar's is the last.
    await userEvent.click(context.canvas.getAllByRole("button", { name: pdf.exportPdf }).at(-1)!);
    await expect(await context.canvas.findByText(pdf.preparing)).toBeVisible();
    await expect(await context.canvas.findByRole("link", { name: pdf.download("1", 1) }, { timeout: 5000 })).toBeVisible();
  },
};

/** The report holds items the viewer can no longer see, for example after a change while it was made (RP-1110): no link, only the line saying so. */
export const ExportPdfGone: Story = {
  render: (args, context) => {
    const bulk = bulkFor(storyLocale(context));
    return (
      <SnagList
        {...args}
        locale={storyLocale(context)}
        labels={labels[storyLocale(context)]}
        bulk={{ ...bulk, report: { ...bulk.report, check: async () => "gone" as const } }}
      />
    );
  },
  play: async (context) => {
    const pdf = reportLabels[storyLocale(context)];
    await userEvent.click(context.canvas.getAllByRole("button", { name: pdf.exportPdf })[0]!);
    await expect(await context.canvas.findByText(pdf.gone, undefined, { timeout: 5000 })).toBeVisible();
    await expect(context.canvas.queryByRole("link", { name: pdf.download("3", 3) })).toBeNull();
  },
};

/** With rows ticked, the bar says how many, and offers Reassign, Move Stage and Export (RP-629). */
export const BulkSelect: Story = {
  render: (args, context) => (
    <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} bulk={bulkFor(storyLocale(context))} />
  ),
  play: async (context) => {
    const text = bulkLabels[storyLocale(context)];
    const table = context.canvas.getByRole("table", { name: labels[storyLocale(context)].table });
    await userEvent.click(within(table).getByRole("checkbox", { name: text.selectRow("Cable tray not bonded") }));
    await userEvent.click(within(table).getByRole("checkbox", { name: text.selectRow("Socket outlet loose") }));
    await expect(context.canvas.getByRole("button", { name: text.reassign })).toBeVisible();
    await expect(context.canvas.getByRole("button", { name: text.moveStage })).toBeVisible();
    await expect(context.canvas.getByRole("button", { name: text.exportSelected })).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: text.clearSelection }));
    await expect(context.canvas.queryByRole("button", { name: text.reassign })).toBeNull();
  },
};

/** Reassign: only the colleagues the API offers, then what was done and what was skipped. */
export const BulkReassign: Story = {
  render: (args, context) => (
    <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} bulk={bulkFor(storyLocale(context))} />
  ),
  play: async (context) => {
    const text = bulkLabels[storyLocale(context)];
    const table = context.canvas.getByRole("table", { name: labels[storyLocale(context)].table });
    await userEvent.click(within(table).getByRole("checkbox", { name: text.selectRow("Cable tray not bonded") }));
    await userEvent.click(context.canvas.getByRole("button", { name: text.reassign }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(await dialog.findByRole("radio", { name: text.colleague(ali.name[storyLocale(context)], storyLocale(context) === "ar" ? "1" : "1", "1") }));
    await userEvent.click(dialog.getByRole("button", { name: text.reassignConfirm }));
    await expect(await dialog.findByText(text.doneCount("1", 1))).toBeVisible();
  },
};

/** Move Stage: the Stage to move to, and the items that could not move, named with their reason. */
export const BulkMove: Story = {
  render: (args, context) => (
    <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} bulk={bulkFor(storyLocale(context))} />
  ),
  play: async (context) => {
    const text = bulkLabels[storyLocale(context)];
    const table = context.canvas.getByRole("table", { name: labels[storyLocale(context)].table });
    await userEvent.click(within(table).getByRole("checkbox", { name: text.selectAll }));
    await userEvent.click(context.canvas.getByRole("button", { name: text.moveStage }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(await dialog.findByRole("radio", { name: stages.inProgress.name[storyLocale(context)] }));
    await userEvent.click(dialog.getByRole("button", { name: text.moveConfirm }));
    await expect((await dialog.findAllByText(text.reasons.not_offered))[0]).toBeVisible();
  },
};

// The phone (RP-630; design/reference/claude-design/ui_kits/app/snag-list-mobile.html): the same List as cards.

/** The Transitions each card's item offers TMC's engineer, as its `actions` would list them. Story data only. */
const offered: Record<string, SwipeAction[]> = {
  [items[0]!.id]: [
    { key: "resolve", label: b("Resolve", "حل"), kind: "submit", tone: "forward" },
    { key: "put_on_hold", label: b("Put on hold", "تعليق"), kind: "send", tone: "move" },
  ],
};
const swipeStub = (take = fn<SnagSwipe["take"]>()): SnagSwipe => ({ load: async (id) => offered[id] ?? [], take });
const phoneCard = (context: { canvas: ReturnType<typeof within> }, subject: string) => context.canvas.getByRole("link", { name: subject }).closest("li")!;
/** A finger dragging a card `dx` pixels sideways. */
async function swipe(card: HTMLElement, dx: number) {
  const surface = card.querySelector<HTMLElement>("[data-swipe-card]")!;
  const box = surface.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const x = box.left + box.width / 2;
  const send = async (type: string, clientX: number) => {
    surface.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, clientX, clientY: y }));
    // Each event's render lands before the next, as between a finger's moves.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  await send("pointerdown", x);
  await send("pointermove", x + dx / 2);
  await send("pointermove", x + dx);
  await send("pointerup", x + dx);
}
const towardsStart = (context: Parameters<NonNullable<Story["play"]>>[0], px: number) => (storyLocale(context) === "ar" ? px : -px);
// The cards' "Actions for …" button is for the keyboard: hidden until it has focus, so its box is the screen reader's 1px.
const phoneParameters = { phone: true, touchTargets: { exempt: [{ selector: "[data-card-actions]", reason: "keyboard-only, shown on focus" }] } };

/**
 * A phone: photo-first cards with the type's shape, the number (left to right in Arabic too), the
 * Subject, the Stage and its Step Age dots, where it is and who holds it; the type chips and
 * Need My Action in one row; the filters behind one button; a large "+". The desktop table is gone.
 */
export const Phone: Story = {
  parameters: phoneParameters,
  args: { phoneNewHref: (code: string) => `#camera-${code}` },
  render: (args, context) => <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} swipe={swipeStub()} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await expect(context.canvas.queryByRole("table")).toBeNull();
    const cards = context.canvas.getByRole("region", { name: text.table });
    await expect(within(cards).getAllByRole("listitem").filter((li) => li.querySelector("[data-swipe-card]"))).toHaveLength(items.length);
    const number = within(cards).getByText("TWR-DCL-EL-SNG-011");
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
    await expect(within(cards).getByText(text.phone.swipeHint)).toBeVisible();
    await expect(within(cards).getByRole("link", { name: text.newOfType(snag.name[storyLocale(context)]) })).toHaveAttribute("href", "#camera-SNG");
    const chips = within(cards).getByRole("navigation", { name: text.types });
    await expect(within(chips).getByRole("link", { name: text.needMyAction })).toHaveAttribute("href", expect.stringContaining("needMyAction=true"));
  },
};

/** Swiping a card shows only what its item offers the viewer; one tap opens that Transition's Action Form (here, the stub's `take`). */
export const PhoneSwipe: Story = {
  parameters: phoneParameters,
  args: { swipe: swipeStub() },
  render: (args, context) => <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />,
  play: async (context) => {
    const card = phoneCard(context, "Cable tray not bonded");
    await swipe(card, towardsStart(context, 170));
    const resolve = await within(card).findByRole("button", { name: storyText(context, b("Resolve", "حل")) });
    await expect(within(card).getAllByRole("button").filter((el) => !el.hasAttribute("data-card-actions"))).toHaveLength(2);
    await userEvent.click(resolve);
    await expect(context.args.swipe!.take).toHaveBeenCalledWith(items[0]!.id, "resolve");
  },
};

/** A card whose item offers the viewer nothing says so, and shows no button; the keyboard opens it too. */
export const PhoneNothingToTake: Story = {
  parameters: phoneParameters,
  args: { swipe: swipeStub() },
  render: (args, context) => <SnagList {...args} locale={storyLocale(context)} labels={labels[storyLocale(context)]} />,
  play: async (context) => {
    const text = labels[storyLocale(context)];
    const card = phoneCard(context, "Socket outlet loose");
    await userEvent.click(within(card).getByRole("button", { name: text.phone.transitionsOf("Socket outlet loose") }));
    await expect(await within(card).findByText(text.phone.noTransitions)).toBeVisible();
    await expect(within(card).getAllByRole("button").filter((el) => !el.hasAttribute("data-card-actions"))).toHaveLength(0);
  },
};

/** The filters in a bottom sheet: Stage and Trade chips and Need My Action, each applied at once; "Show 6 items" closes it. */
export const PhoneFilters: Story = {
  parameters: phoneParameters,
  args: { query: { ...defaults, stage: ["open"] } },
  play: async (context) => {
    const text = labels[storyLocale(context)];
    await userEvent.click(context.canvas.getByRole("button", { name: new RegExp(text.filters) }));
    const sheet = within(await within(document.body).findByRole("dialog", { name: text.filters }));
    await expect(sheet.getByRole("button", { name: stages.open.name[storyLocale(context)] })).toHaveAttribute("aria-pressed", "true");
    // Drafts are never a Stage to filter the List by.
    await expect(sheet.queryByRole("button", { name: stages.draft.name[storyLocale(context)] })).toBeNull();
    await userEvent.click(sheet.getByRole("button", { name: stages.onHold.name[storyLocale(context)] }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ stage: ["open", "on_hold"] }));
    await userEvent.click(sheet.getByRole("switch", { name: text.needMyAction }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith(expect.objectContaining({ needMyAction: true }));
    await userEvent.click(sheet.getByRole("button", { name: text.phone.showItems(storyLocale(context) === "ar" ? "6" : "6", 6) }));
    await expect(within(document.body).queryByRole("dialog")).toBeNull();
  },
};
