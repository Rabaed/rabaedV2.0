import { workItemQuery, workItemSearchParams, type Locale, type WorkItemBoard as WorkItemBoardData, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { SnagList, type SnagListLabels, type SnagListProps } from "./snag-list.tsx";

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
    raisedManually: "Raised by hand",
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
const punch = { code: "WLK", name: b("Walkdown item", "بند جولة") };
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
    type: punch,
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
  types: [comment, snag, punch],
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
    await expect(within(chips).getByRole("link", { name: new RegExp(punch.name[storyLocale(context)]) })).toHaveAttribute("href", expect.stringContaining("type=WLK"));
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
