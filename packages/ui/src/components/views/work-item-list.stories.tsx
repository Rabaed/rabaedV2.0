import { defaultOutcomeSets, workItemQuery, workItemSearchParams, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { workItemListLabels } from "../../storybook/views.ts";
import { WorkItemList, type WorkItemListProps } from "./work-item-list.tsx";

// The Submittals List (RP-345, spec RP-344) as a Contractor engineer of
// Tamkeen sees it: one row per Revision chain, "With" per V14. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  stage: b("Stage", "المرحلة"),
  with: b("With", "لدى"),
  notPickedUp: b("Not picked up", "لم تُستلَم"),
  allRevisions: b("Show all Revisions", "عرض كل المراجعات"),
  needMyAction: b("Need My Action", "بحاجة لإجرائي"),
  nextPage: b("Next page", "الصفحة التالية"),
  firstPage: b("First page", "الصفحة الأولى"),
  clear: b("Clear filters", "مسح التصفية"),
  empty: b("No items you can see match these filters.", "لا توجد عناصر يمكنك رؤيتها تطابق هذه التصفية."),
  table: b("Submittals", "الاعتمادات"),
  submissionDate: b("Submission Date", "تاريخ التقديم"),
  creationDate: b("Creation Date", "تاريخ الإنشاء"),
  submittedFrom: b("Submitted from", "قُدِّم من"),
  sort: b("Sort by", "الترتيب حسب"),
  sortSubmissionDate: b("Submission Date, latest first", "تاريخ التقديم، الأحدث أولًا"),
};

const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  internal: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" as const },
  pending: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const },
  approved: { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const },
  revise: { key: "revise_resubmit", name: b("Revise and Resubmit", "تعديل وإعادة تقديم"), category: "closed_negative" as const },
};
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical", "كهرباء") };
const tower = { id: "00000000-0000-4000-8000-0000000000a1", code: "T1", name: b("Tower 1", "البرج 1") };
const level3 = { id: "00000000-0000-4000-8000-0000000000a2", code: "L3", name: b("Level 3", "الطابق 3") };
const ownCompany = b("Tamkeen Contracting", "تمكين للمقاولات");
const consultant = b("Al Waha PMC", "الواحة لإدارة المشاريع");
const consultantId = "00000000-0000-4000-8000-0000000000c1";
const mar = { code: "MAR", name: b("Material Submittal", "اعتماد مواد") };

const row = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title: "",
  documentNumber: `TWR-TMC-EL-MAR-000${n}`,
  revisionNo: 0,
  stage: stages.pending,
  trade: electrical,
  location: level3,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  with: null,
  // Tamkeen raised these: its Members read the Creation Date too (RP-348).
  submissionDate: "2026-09-14T08:30:00.000Z",
  creationDate: "2026-09-02T07:00:00.000Z",
  ...rest,
});

const items: WorkItemRow[] = [
  row(1, {
    title: "Cable tray support brackets",
    stepAgeWeeks: 4,
    with: { kind: "company", companyName: consultant },
  }),
  row(2, {
    title: "Main LV switchboard",
    stage: stages.internal,
    stepAgeWeeks: 2,
    with: { kind: "own", companyName: ownCompany, step: { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") }, holder: null },
  }),
  row(3, {
    title: "LED downlights",
    documentNumber: "TWR-TMC-EL-MAR-0003 Rev 1",
    revisionNo: 1,
    stage: stages.internal,
    with: {
      kind: "own",
      companyName: ownCompany,
      step: { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") },
      holder: { name: b("Faisal Al Harbi", "فيصل الحربي"), isMe: false },
    },
  }),
  row(4, { title: "Busbar trunking", stage: stages.approved, outcome: "B", location: tower }),
  row(5, { title: "Earthing rods", stage: stages.revise, outcome: "C" }),
  row(6, {
    title: "Fire alarm cables",
    documentNumber: null,
    // A Draft: no number, not Submitted, and no Step Age: nobody sees when it was started.
    submissionDate: null,
    creationDate: null,
    stepEnteredAt: null,
    stepAgeWeeks: null,
    stage: stages.draft,
    with: {
      kind: "own",
      companyName: ownCompany,
      step: { key: "draft", name: b("Draft", "مسودة") },
      holder: { name: b("Sara Al Qahtani", "سارة القحطاني"), isMe: true },
    },
  }),
  row(7, {
    title: "Earthing rods, galvanised",
    documentNumber: null,
    revisionNo: 1,
    submissionDate: null,
    creationDate: null,
    stepEnteredAt: null,
    stepAgeWeeks: null,
    stage: stages.draft,
    with: {
      kind: "own",
      companyName: ownCompany,
      step: { key: "draft", name: b("Draft", "مسودة") },
      holder: { name: b("Sara Al Qahtani", "سارة القحطاني"), isMe: true },
    },
  }),
];

const list: WorkItemListData = {
  stages: [
    { ...stages.draft, count: 1 },
    { ...stages.internal, count: 2 },
    { ...stages.pending, count: 1 },
    { ...stages.approved, count: 1 },
    { ...stages.revise, count: 1 },
  ],
  items,
  nextCursor: null,
  filters: {
    types: [mar],
    outcomes: defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })),
    trades: [electrical],
    locations: [
      { ...tower, parentId: null },
      { ...level3, parentId: tower.id },
    ],
    with: {
      steps: [
        { key: "draft", name: b("Draft", "مسودة") },
        { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") },
      ],
      companies: [{ participantId: consultantId, name: consultant }],
    },
  },
};

const defaults: WorkItemQuery = workItemQuery.parse({});
const hrefFor = (q: WorkItemQuery) => `?${workItemSearchParams(q)}`;

const meta = {
  title: "Views/WorkItemList",
  component: WorkItemList,
  args: {
    list,
    query: defaults,
    locale: "en",
    labels: workItemListLabels.en,
    hrefFor,
    itemHref: (id: string) => `#${id}`,
    onQueryChange: fn<WorkItemListProps["onQueryChange"]>(),
  },
  render: (args, context) => <WorkItemList {...args} locale={storyLocale(context)} labels={workItemListLabels[storyLocale(context)]} />,
} satisfies Meta<typeof WorkItemList>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const cellsOf = (context: PlayContext, title: string) => {
  const link = context.canvas.getByRole("link", { name: title });
  return within(link.closest("tr")!).getAllByRole("cell");
};

/**
 * Wide: every column, one row per chain. "With" names the holder in the
 * viewer's own Company, shows "<Step> · Not picked up", and another Company by its
 * name only (V14). Document Numbers read left to right, in Arabic too.
 */
export const Wide: Story = {
  play: async (context) => {
    const table = context.canvas.getByRole("table", { name: storyText(context, copy.table) });
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(11);
    await expect(within(table).getAllByRole("row")).toHaveLength(items.length + 1);
    const withColumn = 4;
    const locale = storyLocale(context);
    await expect(cellsOf(context, "Cable tray support brackets")[withColumn]).toHaveTextContent(consultant[locale]);
    await expect(cellsOf(context, "Main LV switchboard")[withColumn]).toHaveTextContent(storyText(context, copy.notPickedUp));
    await expect(cellsOf(context, "LED downlights")[withColumn]).toHaveTextContent(b("Faisal Al Harbi", "فيصل الحربي")[locale]);
    await expect(cellsOf(context, "Earthing rods, galvanised")[0]).toHaveTextContent(
      storyText(context, b("Revision 1: no number yet", "المراجعة 1: بلا رقم بعد")),
    );
    const number = within(table).getByText("TWR-TMC-EL-MAR-0003 Rev 1");
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
  },
};

/**
 * The raiser's Company reads both dates; a Draft with no number has neither.
 * Dates read in Latin digits in Arabic too.
 */
export const DatesForTheRaisersCompany: Story = {
  play: async (context) => {
    const table = context.canvas.getByRole("table", { name: storyText(context, copy.table) });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headers.slice(-2)).toEqual([storyText(context, copy.submissionDate), storyText(context, copy.creationDate)]);
    const cells = cellsOf(context, "Main LV switchboard");
    await expect(cells.at(-2)).toHaveTextContent("14");
    await expect(cells.at(-2)).toHaveTextContent("2026");
    await expect(cells.at(-1)).toHaveTextContent("2");
    await expect(cells.at(-1)).not.toHaveTextContent("14");
    const draft = cellsOf(context, "Fire alarm cables");
    await expect(draft.at(-2)).toBeEmptyDOMElement();
    await expect(draft.at(-1)).toBeEmptyDOMElement();
    // No Step Age either (the Step Age column is the 6th): a Draft's start is seen by nobody.
    await expect(draft[5]).toBeEmptyDOMElement();
  },
};

/** Another Company reads the Submission Date only: the API sends no Creation Date, so there is no such column. */
export const DatesForAnotherCompany: Story = {
  args: { list: { ...list, items: items.map((i) => ({ ...i, creationDate: null })) } },
  play: async (context) => {
    const table = context.canvas.getByRole("table", { name: storyText(context, copy.table) });
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(10);
    await expect(within(table).queryByRole("columnheader", { name: storyText(context, copy.creationDate) })).toBeNull();
    await expect(within(table).getByRole("columnheader", { name: storyText(context, copy.submissionDate) })).toBeVisible();
    await expect(cellsOf(context, "Main LV switchboard").at(-1)).toHaveTextContent("2026");
  },
};

/** Choosing a Submission Date range, or sorting by it, asks for the same query with it, from the first page. */
export const SubmissionDateRange: Story = {
  args: { query: { ...defaults, cursor: "abc" } },
  play: async (context) => {
    const from = context.canvas.getByLabelText(storyText(context, copy.submittedFrom));
    await userEvent.type(from, "2026-09-01");
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, submittedFrom: "2026-09-01" });
    await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.sort) }));
    await userEvent.click(await screen.findByRole("option", { name: storyText(context, copy.sortSubmissionDate) }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "submissionDate" });
  },
};

/** Narrow: the toolbar stacks and the table scrolls sideways in its own region. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.table) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
  },
};

/** Choosing a filter asks for the same query with it, from the first page. */
export const ChoosingAFilter: Story = {
  args: { query: { ...defaults, cursor: "abc" } },
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.stage) }));
    await userEvent.click(await screen.findByRole("option", { name: stages.internal.name[storyLocale(context)] }));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, stage: ["internal_review"] });
  },
};

/** "With" offers me, "Not picked up", my own Company's Steps and the other Companies holding my items, by name. */
export const WithChoices: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("combobox", { name: storyText(context, copy.with) }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    await expect(options).toHaveLength(6);
    await userEvent.click(options[5]!);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, with: [`company:${consultantId}`] });
  },
};

/** "Show all Revisions" asks for every visible Revision. */
export const ShowAllRevisions: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("switch", { name: storyText(context, copy.allRevisions) }));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, allRevisions: true });
  },
};

/** Need My Action is off by default; turning it on asks for the items waiting on me, from the first page. */
export const NeedMyActionOff: Story = {
  args: { query: { ...defaults, cursor: "abc" } },
  play: async (context) => {
    const toggle = context.canvas.getByRole("switch", { name: storyText(context, copy.needMyAction) });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, needMyAction: true });
  },
};

/**
 * Need My Action on: the Steps I hold, the not picked up Steps of my pool, and my
 * own Drafts. Turning it off shows every item again; clearing the filters does too.
 */
export const NeedMyActionOn: Story = {
  args: {
    query: { ...defaults, needMyAction: true },
    list: { ...list, items: items.filter((i) => i.with?.kind === "own"), stages: list.stages.map((s) => ({ ...s, count: s.key === "approved" || s.key === "revise_resubmit" ? 0 : s.count })) },
  },
  play: async (context) => {
    const toggle = context.canvas.getByRole("switch", { name: storyText(context, copy.needMyAction) });
    await expect(toggle).toBeChecked();
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.clear) })).toHaveAttribute("href", "?");
    await userEvent.click(toggle);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith(defaults);
  },
};

/** Need My Action on a phone: the toggle stays on screen above the table. */
export const NeedMyActionNarrow: Story = {
  ...NeedMyActionOn,
  parameters: phone,
  play: async (context) => {
    const toggle = context.canvas.getByRole("switch", { name: storyText(context, copy.needMyAction) });
    await expect(toggle).toBeChecked();
    const box = toggle.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(innerWidth);
  },
};

/** A later page links back to the first and on to the next, its filters kept. */
export const Paged: Story = {
  args: { query: { ...defaults, stage: ["internal_review"], cursor: "page2" }, list: { ...list, nextCursor: "page3" } },
  play: async (context) => {
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.firstPage) })).toHaveAttribute("href", "?stage=internal_review");
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.nextPage) })).toHaveAttribute(
      "href",
      "?stage=internal_review&cursor=page3",
    );
  },
};

/** Nothing matches: the table says so, and the filters can be cleared. */
export const NothingMatches: Story = {
  args: {
    query: { ...defaults, stepAgeMin: 4, allRevisions: true },
    list: { ...list, items: [], stages: list.stages.map((s) => ({ ...s, count: 0 })) },
  },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, copy.empty))).toBeVisible();
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.clear) })).toHaveAttribute("href", "?allRevisions=true");
  },
};

// Search (RP-347): in the toolbar, scoped to the Project, kept in the URL.
const search = {
  box: b("Search", "بحث"),
  button: b("Search", "بحث"),
  none: b("No items you can see match this search.", "لا توجد عناصر يمكنك رؤيتها تطابق هذا البحث."),
};

/** Searching asks for the same query with the words, from the first page; an emptied box asks for no search. */
export const Searching: Story = {
  args: { query: { ...defaults, stage: ["pending_approval"], cursor: "abc" } },
  play: async (context) => {
    const box = context.canvas.getByRole("searchbox", { name: storyText(context, search.box) });
    const words = storyText(context, b("LED downlights", "إنارة الممرات"));
    await userEvent.type(box, `  ${words} {enter}`);
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, stage: ["pending_approval"], q: words });
    await userEvent.clear(box);
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, search.button) }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, stage: ["pending_approval"], q: undefined });
  },
};

/** A search with results: the box holds the words, the rows are the matches, and clearing the filters clears it too. */
export const SearchWithResults: Story = {
  args: {
    query: { ...defaults, q: "LED" },
    list: {
      ...list,
      items: items.filter((i) => i.title.includes("LED")),
      stages: list.stages.map((s) => ({ ...s, count: s.key === stages.internal.key ? 1 : 0 })),
    },
  },
  play: async (context) => {
    await expect(context.canvas.getByRole("searchbox", { name: storyText(context, search.box) })).toHaveValue("LED");
    const table = context.canvas.getByRole("table", { name: storyText(context, copy.table) });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.clear) })).toHaveAttribute("href", "?");
  },
};

/** A search with no results says so, and nothing counts what the viewer can't see. */
export const SearchWithNone: Story = {
  args: {
    query: { ...defaults, q: "Xylophonic" },
    list: { ...list, items: [], stages: list.stages.map((s) => ({ ...s, count: 0 })) },
  },
  play: async (context) => {
    await expect(context.canvas.getByText(storyText(context, search.none))).toBeVisible();
    await expect(context.canvas.queryByText(storyText(context, copy.empty))).toBeNull();
  },
};

/** Narrow: the search box takes the whole width above the filters. */
export const SearchNarrow: Story = {
  parameters: phone,
  args: { query: { ...defaults, q: "LED" } },
  play: async (context) => {
    const box = context.canvas.getByRole("searchbox", { name: storyText(context, search.box) });
    await expect(box.getBoundingClientRect().width).toBeGreaterThan(200);
  },
};

/** Opened from a Dashboard number: its buckets are named, and clear with the other filters. */
export const FromTheDashboard: Story = {
  args: { query: { ...defaults, type: ["MAR"], bucket: ["pending"] } },
  play: async (context) => {
    await expect(context.canvas.getByTestId("bucket-filter")).toHaveTextContent(
      storyText(context, b("From the Dashboard: Pending", "من لوحة المعلومات: قيد الانتظار")),
    );
    await expect(context.canvas.getByRole("link", { name: storyText(context, copy.clear) })).toHaveAttribute("href", "?");
  },
};

/** Opened from the Dashboard's Code C line: its sub-state is named. */
export const FromTheCodeCLine: Story = {
  args: { query: { ...defaults, type: ["MAR"], codeC: ["awaitingRevision"] } },
  play: async (context) => {
    await expect(context.canvas.getByTestId("bucket-filter")).toHaveTextContent(
      storyText(context, b("From the Dashboard: awaiting revision", "من لوحة المعلومات: بانتظار التعديل")),
    );
  },
};
