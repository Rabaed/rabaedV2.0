import { defaultOutcomeSets, encodeWorkItemCursor, workItemQuery, workItemSearchParams, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone } from "../../storybook/form.ts";
import { overlay } from "../../storybook/overlay.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { workItemListLabels } from "../../storybook/views.ts";
import { WorkItemList, type WorkItemListProps } from "./work-item-list.tsx";

// The Submittals List (RP-345, spec RP-344) as a Contractor engineer of
// Tamkeen sees it: one row per Revision chain, "With" per V14. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  stage: b("Stage", "المرحلة"),
  with: b("With", "لدى"),
  unclaimed: b("unclaimed", "لم تُستلَم"),
  allRevisions: b("Show all Revisions", "عرض كل المراجعات"),
  needMyAction: b("Need My Action", "بحاجة لإجرائي"),
  nextPage: b("Next page", "الصفحة التالية"),
  firstPage: b("First page", "الصفحة الأولى"),
  previousPage: b("Previous page", "الصفحة السابقة"),
  pages: b("Pages", "الصفحات"),
  filters: b("Filter", "التصفية"),
  status: b("Status", "الحالة"),
  owner: b("Owner", "المسؤول"),
  role: b("Role", "الدور"),
  documentType: b("Document type", "نوع المستند"),
  building: b("Building", "المبنى"),
  type: b("Type", "النوع"),
  clearAll: b("Clear all", "مسح الكل"),
  clear: b("Clear filters", "مسح التصفية"),
  empty: b("No items you can see match these filters.", "لا توجد عناصر يمكنك رؤيتها تطابق هذه التصفية."),
  table: b("Submittals", "الاعتمادات"),
  submissionDate: b("Submission Date", "تاريخ التقديم"),
  creationDate: b("Creation Date", "تاريخ الإنشاء"),
  submittedFrom: b("Submitted from", "قُدِّم من"),
  documentNumber: b("Document Number", "رقم المستند"),
  subject: b("Subject", "الموضوع"),
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
const saraId = "00000000-0000-4000-8000-0000000000d1";
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
      claimer: { name: b("Sara Al Qahtani", "سارة القحطاني"), isMe: true },
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
    outcomes: defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })),
    trades: [electrical],
    locations: [
      { ...tower, parentId: null, depth: 1, levelName: b("Building", "المبنى") },
      { ...level3, parentId: tower.id, depth: 2, levelName: b("Floor", "الطابق") },
    ],
    with: {
      steps: [
        { key: "draft", name: b("Draft", "مسودة") },
        { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") },
      ],
      companies: [{ participantId: consultantId, name: consultant }],
    },
    owners: [{ memberId: saraId, name: b("Sara Al Qahtani", "سارة القحطاني") }],
  },
};

const defaults: WorkItemQuery = workItemQuery.parse({});
// As the web keeps it: the pages before a later page, after its query.
const hrefFor = (q: WorkItemQuery, trail?: readonly string[]) => {
  const params = workItemSearchParams(q);
  if (q.cursor !== undefined && trail !== undefined) {
    params.set("page", String(trail.length + 2));
    for (const cursor of trail) params.append("before", cursor);
  }
  return `?${params}`;
};
// Cursors as the API makes them, for the sort by Step Age.
const cursorAfter = (n: number) => encodeWorkItemCursor("stepAge", ["false", "", `Item ${n}`, `00000000-0000-4000-8000-00000000010${n}`]);

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

/** Opens the Filters and shows `field`'s values; returns the panel. */
const openFilters = async (context: PlayContext, field: { en: string; ar: string }) => {
  await userEvent.click(context.canvas.getByRole("button", { name: new RegExp(`^${storyText(context, copy.filters)}( \\d+)?$`) }));
  const panel = await screen.findByRole("dialog", { name: storyText(context, copy.filters) });
  await userEvent.click(within(panel).getByRole("tab", { name: new RegExp(`^${storyText(context, field)}( \\d+)?$`) }));
  return panel;
};

/** Choosing a Submission Date range asks for the same query with it, from the first page. */
export const SubmissionDateRange: Story = {
  args: { query: { ...defaults, cursor: "abc" } },
  play: async (context) => {
    const panel = await openFilters(context, copy.submissionDate);
    await userEvent.type(within(panel).getByLabelText(storyText(context, copy.submittedFrom)), "2026-09-01");
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, submittedFrom: "2026-09-01" });
  },
};

/**
 * Sorting is in the column headers, for the sorts that exist: the current one
 * is announced with its order; another asks for the query sorted by it, from the first page.
 */
export const SortingByAColumn: Story = {
  args: { query: { ...defaults, cursor: "abc" } },
  play: async (context) => {
    const table = context.canvas.getByRole("table", { name: storyText(context, copy.table) });
    await expect(within(table).getByRole("columnheader", { name: storyText(context, b("Step Age", "عمر الخطوة")) })).toHaveAttribute("aria-sort", "descending");
    await expect(within(table).getByRole("columnheader", { name: storyText(context, copy.subject) })).not.toHaveAttribute("aria-sort");
    await userEvent.click(within(table).getByRole("button", { name: storyText(context, copy.submissionDate) }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "submissionDate" });
    await userEvent.click(within(table).getByRole("button", { name: storyText(context, copy.documentNumber) }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "documentNumber" });
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
    const panel = await openFilters(context, copy.status);
    await userEvent.click(within(panel).getByRole("checkbox", { name: stages.internal.name[storyLocale(context)] }));
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, stage: ["internal_review"] });
  },
};

/** Several values of one field, any of them (RP-410): a second Stage joins the first; unticking one leaves the other. */
export const SeveralValues: Story = {
  args: { query: { ...defaults, stage: ["internal_review"] } },
  play: async (context) => {
    const panel = await openFilters(context, copy.status);
    const locale = storyLocale(context);
    await expect(within(panel).getByRole("checkbox", { name: stages.internal.name[locale] })).toBeChecked();
    await userEvent.click(within(panel).getByRole("checkbox", { name: stages.pending.name[locale] }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, stage: ["internal_review", "pending_approval"] });
    await userEvent.click(within(panel).getByRole("checkbox", { name: stages.internal.name[locale] }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, stage: [] });
  },
};

/** Owner offers my own Company's people, my unclaimed pool and the other Companies holding my items, by name only (V14). */
export const OwnerChoices: Story = {
  play: async (context) => {
    const panel = await openFilters(context, copy.owner);
    const choices = within(within(panel).getByRole("group", { name: storyText(context, copy.owner) })).getAllByRole("checkbox");
    await expect(choices).toHaveLength(3);
    await expect(choices[0]).toHaveAccessibleName(storyText(context, b("Sara Al Qahtani", "سارة القحطاني")));
    await expect(choices[1]).toHaveAccessibleName(storyText(context, b("Unclaimed", "لم تُستلَم")));
    await expect(choices[2]).toHaveAccessibleName(storyText(context, consultant));
    await userEvent.click(choices[2]!);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, owner: [`company:${consultantId}`] });
  },
};

/** Role offers my own Company's Steps only: another Company is one lane, never its roles (V5). */
export const RoleChoices: Story = {
  play: async (context) => {
    const panel = await openFilters(context, copy.role);
    const choices = within(within(panel).getByRole("group", { name: storyText(context, copy.role) })).getAllByRole("checkbox");
    await expect(choices).toHaveLength(2);
    await userEvent.click(choices[1]!);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, role: ["internal_review"] });
  },
};

/** A Location level is its own field, named by the level: its values add to the Location filter. */
export const LocationLevels: Story = {
  args: { query: { ...defaults, location: [level3.id] } },
  play: async (context) => {
    const panel = await openFilters(context, copy.building);
    await userEvent.click(within(panel).getByRole("checkbox", { name: tower.name[storyLocale(context)] }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, location: [level3.id, tower.id] });
  },
};

/**
 * The filters applied: the Filters button counts them, each field its values,
 * the chosen value is pressed, and "Clear all" clears them but not the search
 * or Need My Action. Left open for the screenshot.
 */
export const FiltersOpen: Story = {
  parameters: overlay,
  args: { query: { ...defaults, stage: ["pending_approval"], stepAgeMin: 2, needMyAction: true, q: "LED" } },
  play: async (context) => {
    const button = context.canvas.getByRole("button", { name: `${storyText(context, copy.filters)} 2` });
    await userEvent.click(button);
    const panel = await screen.findByRole("dialog", { name: storyText(context, copy.filters) });
    await expect(within(panel).getByRole("tab", { name: `${storyText(context, copy.status)} 1` })).toBeVisible();
    await userEvent.click(within(panel).getByRole("tab", { name: `${storyText(context, copy.status)} 1` }));
    await expect(within(panel).getByRole("checkbox", { name: stages.pending.name[storyLocale(context)] })).toBeChecked();
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, copy.clearAll) }));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, needMyAction: true, q: "LED" });
  },
};

/** On a phone the filters open in a sheet, every field one under the other. Left open for the screenshot. */
export const FiltersOnAPhone: Story = {
  parameters: { ...phone, ...overlay },
  args: { query: { ...defaults, type: ["MAR"] } },
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: `${storyText(context, copy.filters)} 1` }));
    const sheet = await screen.findByRole("dialog", { name: storyText(context, copy.filters) });
    await expect(within(sheet).getByRole("heading", { name: `${storyText(context, copy.documentType)} 1` })).toBeVisible();
    await expect(within(sheet).getByRole("group", { name: storyText(context, copy.status) })).toBeInTheDocument();
    await expect(within(sheet).queryByRole("tab")).toBeNull();
  },
};

/** "Show all Revisions" asks for every visible Revision. */
export const ShowAllRevisions: Story = {
  play: async (context) => {
    const panel = await openFilters(context, b("Revisions", "المراجعات"));
    await userEvent.click(within(panel).getByRole("checkbox", { name: storyText(context, copy.allRevisions) }));
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
 * Need My Action on: the Steps I hold, the unclaimed Steps of my pool, and my
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

/** 120 items in all: three pages of 50. */
const longList = { ...list, stages: list.stages.map((s) => ({ ...s, count: s.key === "pending_approval" ? 115 : s.count })) };
const pager = (context: PlayContext) => within(context.canvas.getByRole("navigation", { name: storyText(context, copy.pages) }));

/** The first page: no way back, on to the next, and how many pages and items there are. */
export const FirstPage: Story = {
  args: { list: { ...longList, nextCursor: cursorAfter(1) } },
  play: async (context) => {
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.firstPage) })).toBeNull();
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.previousPage) })).toBeNull();
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.nextPage) })).toHaveAttribute("href", `?cursor=${cursorAfter(1)}&page=2`);
    await expect(pager(context).getByText(storyText(context, b("Page 1 of 3 · 120 items", "صفحة 1 من 3 · 120 عناصر")))).toBeVisible();
  },
};

/**
 * A later page reached from this List: its number, back to the one before
 * and to the first, on to the next, its filters kept.
 */
export const Paged: Story = {
  args: {
    query: { ...defaults, stage: ["pending_approval"], cursor: cursorAfter(2) },
    pageTrail: [cursorAfter(1)],
    list: { ...longList, nextCursor: cursorAfter(3) },
  },
  play: async (context) => {
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.firstPage) })).toHaveAttribute("href", "?stage=pending_approval");
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.previousPage) })).toHaveAttribute(
      "href",
      `?stage=pending_approval&cursor=${cursorAfter(1)}&page=2`,
    );
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.nextPage) })).toHaveAttribute(
      "href",
      `?stage=pending_approval&cursor=${cursorAfter(3)}&page=4&before=${cursorAfter(1)}&before=${cursorAfter(2)}`,
    );
    await expect(pager(context).getByText(storyText(context, b("Page 3 of 3 · 120 items", "صفحة 3 من 3 · 120 عناصر")))).toBeVisible();
  },
};

/** A later page opened from a link elsewhere: back to the first only, and no page number, which isn't known. */
export const PagedFromALink: Story = {
  args: { query: { ...defaults, cursor: cursorAfter(2) }, list: longList },
  play: async (context) => {
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.firstPage) })).toHaveAttribute("href", "?");
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.previousPage) })).toBeNull();
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.nextPage) })).toBeNull();
    await expect(pager(context).getByText(storyText(context, b("120 items", "120 عناصر")))).toBeVisible();
  },
};

/** Under a search there is no total ("Search and filters"): the pager says the page alone. */
export const PagedUnderASearch: Story = {
  args: { query: { ...defaults, q: "LED", cursor: cursorAfter(1) }, pageTrail: [], list: { ...longList, nextCursor: cursorAfter(2) } },
  play: async (context) => {
    await expect(pager(context).getByText(storyText(context, b("Page 2", "صفحة 2")), { exact: true })).toBeVisible();
    await expect(pager(context).queryByText(/120/)).toBeNull();
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.previousPage) })).toHaveAttribute("href", "?q=LED");
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
  help: b("Searches Document Number, Subject, Type, Trade, Location and Company", "يبحث في رقم المستند والموضوع والنوع والتخصص والموقع والشركة"),
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
    await userEvent.type(box, "{enter}");
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, stage: ["pending_approval"], q: undefined });
  },
};

/** "/" anywhere on the page puts the cursor in the search box, but types a "/" in another text box. */
export const SlashFocusesSearch: Story = {
  play: async (context) => {
    const box = context.canvas.getByRole("searchbox", { name: storyText(context, search.box) });
    await expect(box).toHaveAccessibleDescription(storyText(context, search.help));
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("/");
    await expect(box).toHaveFocus();
    await expect(box).toHaveValue("");
    await userEvent.keyboard("/");
    await expect(box).toHaveValue("/");
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
