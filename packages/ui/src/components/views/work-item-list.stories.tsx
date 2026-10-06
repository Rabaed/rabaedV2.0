import { workItemQuery, workItemSearchParams, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { WorkItemList, type WorkItemListProps } from "./work-item-list.tsx";

// The Submittals List (RP-345, spec RP-344) as a Contractor engineer of
// Tamkeen sees it: one row per Revision chain, "With" per V14. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  stage: b("Stage", "المرحلة"),
  with: b("With", "لدى"),
  unclaimed: b("unclaimed", "لم تُستلَم"),
  allRevisions: b("Show all Revisions", "عرض كل المراجعات"),
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
    with: { kind: "own", companyName: ownCompany, step: { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") }, claimer: null },
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
      claimer: { name: b("Faisal Al Harbi", "فيصل الحربي"), isMe: false },
    },
  }),
  row(4, { title: "Busbar trunking", stage: stages.approved, outcome: "B", location: tower }),
  row(5, { title: "Earthing rods", stage: stages.revise, outcome: "C" }),
  row(6, {
    title: "Fire alarm cables",
    documentNumber: null,
    // A Draft: no number, not Submitted.
    submissionDate: null,
    creationDate: null,
    stage: stages.draft,
    with: {
      kind: "own",
      companyName: ownCompany,
      step: { key: "draft", name: b("Draft", "مسودة") },
      claimer: { name: b("Sara Al Qahtani", "سارة القحطاني"), isMe: true },
    },
  }),
  row(7, {
    title: "Earthing rods, galvanised",
    documentNumber: null,
    revisionNo: 1,
    stage: stages.draft,
    with: {
      kind: "own",
      companyName: ownCompany,
      step: { key: "draft", name: b("Draft", "مسودة") },
      claimer: { name: b("Sara Al Qahtani", "سارة القحطاني"), isMe: true },
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
    hrefFor,
    itemHref: (id: string) => `#${id}`,
    onQueryChange: fn<WorkItemListProps["onQueryChange"]>(),
  },
  render: (args, context) => <WorkItemList {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof WorkItemList>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const cellsOf = (context: PlayContext, title: string) => {
  const link = context.canvas.getByRole("link", { name: title });
  return within(link.closest("tr")!).getAllByRole("cell");
};

/**
 * Wide: every column, one row per chain. "With" names the claimer in the
 * viewer's own Company, shows "<Step> · unclaimed", and another Company by its
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
    await expect(cellsOf(context, "Main LV switchboard")[withColumn]).toHaveTextContent(storyText(context, copy.unclaimed));
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

/** "With" offers me, unclaimed, my own Company's Steps and the other Companies holding my items, by name. */
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
