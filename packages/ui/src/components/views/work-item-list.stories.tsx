import { defaultOutcomeSets, listColumns, workItemQuery, workItemSearchParams, type WorkItemList as WorkItemListData, type WorkItemQuery, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone } from "../../storybook/form.ts";
import { overlay } from "../../storybook/overlay.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { workItemListLabels } from "../../storybook/views.ts";
import { WorkItemList, type WorkItemListProps } from "./work-item-list.tsx";

// The Submittals List (RP-409, the owner's design; spec RP-344) as a Contractor
// engineer of Tamkeen sees it: one row per Revision chain, the owner per V14.
// Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  notPickedUp: b("Not picked up", "لم تُستلَم"),
  allRevisions: b("Show all Revisions", "عرض كل المراجعات"),
  needMyAction: b("Need My Action", "بحاجة لإجرائي"),
  nextPage: b("Next page", "الصفحة التالية"),
  firstPage: b("First page", "الصفحة الأولى"),
  previousPage: b("Previous page", "الصفحة السابقة"),
  lastPage: b("Last page", "الصفحة الأخيرة"),
  pages: b("Pages", "الصفحات"),
  filters: b("Filter", "التصفية"),
  status: b("Status", "الحالة"),
  owner: b("Owner", "المسؤول"),
  role: b("Role", "الدور"),
  documentType: b("Document type", "نوع المستند"),
  building: b("Building", "المبنى"),
  clearAll: b("Clear all", "مسح الكل"),
  clear: b("Clear filters", "مسح التصفية"),
  empty: b("No items you can see match these filters.", "لا توجد عناصر يمكنك رؤيتها تطابق هذه التصفية."),
  table: b("Submittals", "الاعتمادات"),
  submissionDate: b("Submission Date", "تاريخ التقديم"),
  submittedFrom: b("Submitted from", "قُدِّم من"),
  number: b("Submittal No.", "رقم التقديم"),
  title: b("Title", "العنوان"),
  created: b("Created", "التاريخ"),
  currentOwner: b("Current owner", "المسؤول الحالي"),
  settings: b("Table settings", "إعدادات الجدول"),
  group: b("Group", "تجميع"),
  export: b("Export", "تصدير"),
  exportOptions: b("Export options", "خيارات التصدير"),
};

const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  internal: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" as const },
  pending: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const },
  approved: { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const },
  revise: { key: "revise_resubmit", name: b("Revise and Resubmit", "تعديل وإعادة تقديم"), category: "closed_negative" as const },
};
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") };
const zone = { id: "00000000-0000-4000-8000-0000000000a0", code: "ZA", name: b("Zone A", "المنطقة A") };
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
  raiserCompanyName: ownCompany,
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
  row(4, { title: "Busbar trunking", stage: stages.approved, outcome: "A", location: tower, closedBy: { kind: "company", companyName: consultant } }),
  row(5, { title: "Earthing rods", stage: stages.revise, outcome: "C", location: zone, closedBy: { kind: "company", companyName: consultant } }),
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
    { ...stages.draft, count: 2 },
    { ...stages.internal, count: 2 },
    { ...stages.pending, count: 1 },
    { ...stages.approved, count: 1 },
    { ...stages.revise, count: 1 },
  ],
  items,
  nextCursor: null,
  page: { number: 1, size: 25, hasNext: false },
  filters: {
    types: [mar],
    outcomes: defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })),
    trades: [electrical],
    // Zone, Building and Floor: the tree's three levels, named, so the List names its columns by them.
    locations: [
      { ...zone, parentId: null, depth: 1, levelName: b("Zone", "المنطقة") },
      { ...tower, parentId: zone.id, depth: 2, levelName: b("Building", "المبنى") },
      { ...level3, parentId: tower.id, depth: 3, levelName: b("Floor", "الطابق") },
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
    onSaveColumns: fn<NonNullable<WorkItemListProps["onSaveColumns"]>>(async () => true),
    loadExportRows: fn<NonNullable<WorkItemListProps["loadExportRows"]>>(async () => ({ items, capped: false })),
    projectName: "Riyadh Gate Tower",
    rowActions: {
      load: async (r: WorkItemRow) => ({
        edit: r.stage.category === "draft",
        duplicate: true,
        resubmit: r.outcome === "C",
        download: true,
        delete: r.stage.category === "draft" && r.revisionNo > 0,
      }),
      run: fn(async () => null),
    },
  },
  render: (args, context) => <WorkItemList {...args} locale={storyLocale(context)} labels={workItemListLabels[storyLocale(context)]} />,
} satisfies Meta<typeof WorkItemList>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const tableOf = (context: PlayContext) => context.canvas.getByRole("table", { name: storyText(context, copy.table) });
const cellsOf = (context: PlayContext, title: string) => {
  const link = context.canvas.getByRole("link", { name: title });
  return within(link.closest("tr")!).getAllByRole("cell");
};
/** A cell of `title`'s row under the column headed `header`. */
const cellOf = (context: PlayContext, title: string, header: { en: string; ar: string }) => {
  const headers = within(tableOf(context)).getAllByRole("columnheader").map((h) => h.textContent ?? "");
  return cellsOf(context, title)[headers.findIndex((h) => h === storyText(context, header))]!;
};

/**
 * A sort button that keyboard focus reaches is never left under a pinned column: the
 * table scrolls it clear of the settings column at the end (WCAG 2.4.11).
 */
export const FocusedSortButtonInView: Story = {
  play: async (context) => {
    const headers = within(tableOf(context)).getAllByRole("columnheader");
    // The last data column's: the one that starts under the pinned settings column.
    const button = within(headers[headers.length - 2]!).getByRole("button");
    button.focus();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const box = button.getBoundingClientRect();
    for (const x of [box.left + 2, box.left + box.width / 2, box.right - 2]) {
      await expect(document.elementFromPoint(x, box.top + box.height / 2)?.closest("button")).toBe(button);
    }
  },
};

/**
 * Wide: the owner's design's columns, 12 shown of 14 (no Due date; Contractor and
 * Step Age off), a checkbox first and the settings last. The Current owner is my
 * own Company's person or Step not picked up, another Company by its name only, and on
 * a closed item who closed it (V14). The Rev is its own chip, the number left
 * without its " Rev n"; numbers read left to right, in Arabic too.
 */
export const Wide: Story = {
  play: async (context) => {
    const table = tableOf(context);
    // Checkbox, 12 columns, settings.
    await expect(within(table).getAllByRole("columnheader")).toHaveLength(14);
    await expect(within(table).getAllByRole("row")).toHaveLength(items.length + 1);
    const locale = storyLocale(context);
    await expect(cellOf(context, "Cable tray support brackets", copy.currentOwner)).toHaveTextContent(consultant[locale]);
    await expect(cellOf(context, "Main LV switchboard", copy.currentOwner)).toHaveTextContent(storyText(context, copy.notPickedUp));
    await expect(cellOf(context, "LED downlights", copy.currentOwner)).toHaveTextContent(b("Faisal Al Harbi", "فيصل الحربي")[locale]);
    await expect(cellOf(context, "Busbar trunking", copy.currentOwner)).toHaveTextContent(consultant[locale]);
    await expect(cellOf(context, "Busbar trunking", b("Code", "الرمز"))).toHaveTextContent("Code A");
    await expect(cellOf(context, "Earthing rods", b("Zone", "المنطقة"))).toHaveTextContent(zone.name[locale]);
    await expect(cellOf(context, "Earthing rods", b("Building", "المبنى"))).toHaveTextContent("—");
    await expect(cellOf(context, "Earthing rods, galvanised", copy.number)).toHaveTextContent(
      storyText(context, b("Revision 1: no number yet", "المراجعة 1: بلا رقم بعد")),
    );
    await expect(cellOf(context, "LED downlights", b("Rev", "المراجعة"))).toHaveTextContent("R1");
    const number = within(table).getByText("TWR-TMC-EL-MAR-0003");
    await expect(getComputedStyle(number).direction).toBe("ltr");
    await expectLaidOutLeftToRight(number);
    // The Review Code column reads "Code A" in Arabic too, whole badge left to right, with its icon (RP-522): A a check, C a refresh.
    const codeA = table.querySelector<HTMLElement>('[data-outcome="A"]')!;
    await expect(codeA).toHaveTextContent("Code A");
    await expect(getComputedStyle(codeA).direction).toBe("ltr");
    await expect(codeA.querySelector("svg.tabler-icon-circle-check")).not.toBeNull();
    await expect(table.querySelector('[data-outcome="C"] svg.tabler-icon-refresh')).not.toBeNull();
  },
};

/**
 * Created is the Creation Date on my own Company's items, else the Submission
 * Date; a Draft with no number has neither. Latin digits in Arabic too.
 */
export const CreatedForTheRaisersCompany: Story = {
  play: async (context) => {
    await expect(cellOf(context, "Main LV switchboard", copy.created)).toHaveTextContent("02");
    await expect(cellOf(context, "Main LV switchboard", copy.created)).toHaveTextContent("2026");
    await expect(cellOf(context, "Fire alarm cables", copy.created)).toHaveTextContent("—");
  },
};

/** Another Company reads the Submission Date only: the API sends it no Creation Date. */
export const CreatedForAnotherCompany: Story = {
  args: { list: { ...list, items: items.map((i) => ({ ...i, creationDate: null })) } },
  play: async (context) => {
    await expect(cellOf(context, "Main LV switchboard", copy.created)).toHaveTextContent("14");
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
  args: { query: { ...defaults, page: 3 } },
  play: async (context) => {
    const panel = await openFilters(context, copy.submissionDate);
    await userEvent.type(within(panel).getByLabelText(storyText(context, copy.submittedFrom)), "2026-09-01");
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, submittedFrom: "2026-09-01" });
  },
};

/**
 * Every column sorts (RP-409): the current one is announced with its order and
 * its arrow; another asks for the query sorted by it in its own order, from the
 * first page; the current one again turns it round.
 */
export const SortingByAColumn: Story = {
  args: { query: { ...defaults, sort: "documentNumber", page: 2 } },
  play: async (context) => {
    const table = tableOf(context);
    await expect(within(table).getByRole("columnheader", { name: new RegExp(storyText(context, copy.number)) })).toHaveAttribute("aria-sort", "ascending");
    await expect(within(table).getByRole("columnheader", { name: new RegExp(storyText(context, copy.title)) })).toHaveAttribute("aria-sort", "none");
    const sortBy = (header: { en: string; ar: string }) =>
      within(table).getByRole("button", { name: storyText(context, b(`Sort by ${header.en}`, `الترتيب حسب ${header.ar}`)) });
    await userEvent.click(sortBy(copy.title));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "subject", dir: "asc" });
    await userEvent.click(sortBy(copy.created));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "created", dir: "desc" });
    await userEvent.click(sortBy(copy.number));
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, sort: "documentNumber", dir: "desc" });
  },
};

/** Narrow: the toolbar wraps and the table scrolls sideways in its own region, the page never. */
export const Narrow: Story = {
  parameters: phone,
  play: async (context) => {
    const region = context.canvas.getByRole("region", { name: storyText(context, copy.table) });
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};

/**
 * Column settings (RP-409): the columns in order, Submittal No. and Title locked,
 * "12 / 14 shown"; a switch shows a column at once, Reset goes back to the
 * design's, "Save as my default" keeps them. Left open for the screenshot.
 */
export const ColumnSettingsOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.settings) }));
    const panel = await screen.findByRole("dialog", { name: storyText(context, b("Columns", "الأعمدة")) });
    await expect(within(panel).getByText(storyText(context, b("12 / 14 shown", "12 / 14 معروض")))).toBeVisible();
    await expect(within(panel).getAllByRole("switch")).toHaveLength(12);
    await userEvent.click(within(panel).getByRole("switch", { name: storyText(context, b("Contractor", "المقاول")) }));
    await expect(within(panel).getByText(storyText(context, b("13 / 14 shown", "13 / 14 معروض")))).toBeVisible();
    await expect(within(tableOf(context)).getByRole("columnheader", { name: new RegExp(storyText(context, b("Contractor", "المقاول"))) })).toBeVisible();
    await userEvent.click(within(panel).getByRole("button", { name: storyText(context, b("Save as my default", "حفظ كافتراضي")) }));
    await expect(context.args.onSaveColumns).toHaveBeenCalledWith(
      listColumns(null).map((c) => (c.key === "contractor" ? { ...c, shown: true } : c)),
    );
  },
};

/** A column moves with the arrow keys on its handle, never above the locked ones. */
export const MovingAColumn: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.settings) }));
    const panel = await screen.findByRole("dialog", { name: storyText(context, b("Columns", "الأعمدة")) });
    const handle = within(panel).getByRole("button", { name: storyText(context, b("Move Current owner", "نقل المسؤول الحالي")) });
    handle.focus();
    for (let i = 0; i < 12; i++) await userEvent.keyboard("{ArrowUp}");
    const headers = within(tableOf(context)).getAllByRole("columnheader").map((h) => h.textContent);
    await expect(headers.slice(1, 4)).toEqual([storyText(context, copy.number), storyText(context, copy.title), storyText(context, copy.currentOwner)]);
    await userEvent.keyboard("{Escape}");
  },
};

/** Rows chosen with their checkboxes: the bulk bar counts them, exports them, and clears them. */
export const RowsSelected: Story = {
  play: async (context) => {
    const table = tableOf(context);
    await userEvent.click(within(table).getByRole("checkbox", { name: storyText(context, b("Select Main LV switchboard", "تحديد Main LV switchboard")) }));
    await userEvent.click(within(table).getByRole("checkbox", { name: storyText(context, b("Select LED downlights", "تحديد LED downlights")) }));
    await expect(context.canvas.getByText(storyText(context, b("2 selected", "2 محدد")))).toBeVisible();
    await expect(within(table).getByRole("checkbox", { name: storyText(context, b("Select all on this page", "تحديد الكل في هذه الصفحة")) })).toHaveAttribute(
      "data-state",
      "indeterminate",
    );
    await expect(context.canvas.getByRole("button", { name: storyText(context, b("Export selected", "تصدير المحدد")) })).toBeVisible();
  },
};

/** Select all: every row of this page; again, none. */
export const SelectAll: Story = {
  play: async (context) => {
    const table = tableOf(context);
    const all = within(table).getByRole("checkbox", { name: storyText(context, b("Select all on this page", "تحديد الكل في هذه الصفحة")) });
    await userEvent.click(all);
    await expect(context.canvas.getByText(storyText(context, b(`${items.length} selected`, `${items.length} محدد`)))).toBeVisible();
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, b("Clear selection", "مسح التحديد")) }));
    await expect(within(table).queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  },
};

/** Group by Status: the page's rows under a header per Stage, in the Project's order, with their counts; a header folds its rows. */
export const GroupedByStatus: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.group) }));
    await userEvent.click(await screen.findByRole("button", { name: storyText(context, copy.status) }));
    const table = tableOf(context);
    const headers = within(table).getAllByRole("button", { expanded: true });
    await expect(headers.map((h) => h.textContent)).toEqual(
      [
        [stages.draft, 2],
        [stages.internal, 2],
        [stages.pending, 1],
        [stages.approved, 1],
        [stages.revise, 1],
      ].map(([s, n]) => `${(s as typeof stages.draft).name[storyLocale(context)]}${storyText(context, n === 1 ? b("1 on this page", "واحد في هذه الصفحة") : b(`${n} on this page`, `${n} في هذه الصفحة`))}`),
    );
    await userEvent.click(headers[0]!);
    await expect(context.canvas.queryByRole("link", { name: "Fire alarm cables" })).toBeNull();
    await expect(context.canvas.getByRole("button", { name: new RegExp(storyText(context, b("Group: Status", "تجميع: الحالة"))) })).toBeVisible();
  },
};

/** The Group menu: GROUP BY Status, Discipline, Type, Current owner, Zone, Code. Left open for the screenshot. */
export const GroupMenuOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.group) }));
    const menu = await screen.findByRole("dialog");
    await expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(
      [copy.status, b("Discipline", "التخصص"), b("Type", "النوع"), copy.currentOwner, b("Zone", "المنطقة"), b("Code", "الرمز")].map((c) => storyText(context, c)),
    );
  },
};

/** Export: the rows the viewer reads, saved as a file, then "Exported 7 submittals (CSV)". The arrow offers CSV or Excel. */
export const Exporting: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.export) }));
    await expect(context.args.loadExportRows).toHaveBeenCalled();
    await waitFor(() => expect(context.canvas.getByText(storyText(context, b("Exported 7 submittals (CSV)", "تم تصدير 7 تقديم (CSV)")))).toBeVisible());
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, copy.exportOptions) }));
    const menu = await screen.findByRole("dialog", { name: storyText(context, copy.exportOptions) });
    await expect(within(menu).getAllByRole("button")).toHaveLength(4);
    await expect(within(menu).getByRole("group", { name: storyText(context, b("Export the whole table", "تصدير الجدول كاملًا")) })).toBeVisible();
  },
};

/**
 * A row's ⋯ menu: Open always; the rest only where the item allows, as the API
 * answers when it opens. A Draft Revision may be edited and deleted (Delete apart,
 * in red). Left open for the screenshot.
 */
export const RowMenuOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    const more = context.canvas.getByRole("button", { name: storyText(context, b("More for Earthing rods, galvanised", "المزيد لـ Earthing rods, galvanised")) });
    // Its name shows on hover too.
    await expect(more).toHaveAttribute("title", storyText(context, b("More for Earthing rods, galvanised", "المزيد لـ Earthing rods, galvanised")));
    await userEvent.click(more);
    const menu = await screen.findByRole("menu", { name: storyText(context, b("More for Earthing rods, galvanised", "المزيد لـ Earthing rods, galvanised")) });
    await waitFor(() =>
      expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(
        [b("Open", "فتح"), b("Edit", "تعديل"), b("Duplicate", "تكرار"), b("Download", "تنزيل"), b("Delete", "حذف")].map((c) => storyText(context, c)),
      ),
    );
  },
};

/** The row menu by keyboard: Enter opens it on its first command; the arrows, Home and End move; Escape returns to the button. */
export const RowMenuByKeyboard: Story = {
  parameters: overlay,
  play: async (context) => {
    const more = context.canvas.getByRole("button", { name: storyText(context, b("More for Earthing rods, galvanised", "المزيد لـ Earthing rods, galvanised")) });
    more.focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getAllByRole("menuitem")).toHaveLength(5));
    const item = (name: { en: string; ar: string }) => within(menu).getByRole("menuitem", { name: storyText(context, name) });
    await waitFor(() => expect(item(b("Open", "فتح"))).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    await expect(item(b("Edit", "تعديل"))).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(item(b("Delete", "حذف"))).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(item(b("Open", "فتح"))).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
  },
};

/** Delete asks first; only then is the row's Delete taken. */
export const DeleteAsksFirst: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: storyText(context, b("More for Earthing rods, galvanised", "المزيد لـ Earthing rods, galvanised")) }));
    const menu = await screen.findByRole("menu");
    await userEvent.click(await within(menu).findByRole("menuitem", { name: storyText(context, b("Delete", "حذف")) }));
    const ask = await screen.findByRole("dialog", { name: storyText(context, b("Delete this Draft?", "حذف هذه المسودة؟")) });
    await expect(context.args.rowActions!.run).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole("button", { name: storyText(context, b("Delete", "حذف")) }));
    await expect(context.args.rowActions!.run).toHaveBeenCalledWith(items[6], "delete");
  },
};

/** Choosing a filter asks for the same query with it, from the first page. */
export const ChoosingAFilter: Story = {
  args: { query: { ...defaults, page: 2 } },
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

/** Owner offers my own Company's people, my pool's Steps not picked up and the other Companies holding my items, by name only (V14). */
export const OwnerChoices: Story = {
  play: async (context) => {
    const panel = await openFilters(context, copy.owner);
    const choices = within(within(panel).getByRole("group", { name: storyText(context, copy.owner) })).getAllByRole("checkbox");
    await expect(choices).toHaveLength(3);
    await expect(choices[0]).toHaveAccessibleName(storyText(context, b("Sara Al Qahtani", "سارة القحطاني")));
    await expect(choices[1]).toHaveAccessibleName(storyText(context, b("Not picked up", "لم تُستلَم")));
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
    await userEvent.click(within(panel).getByRole("checkbox", { name: new RegExp(`^${tower.name[storyLocale(context)]}`) }));
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
  args: { query: { ...defaults, page: 2 } },
  play: async (context) => {
    const toggle = context.canvas.getByRole("switch", { name: storyText(context, copy.needMyAction) });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await expect(context.args.onQueryChange).toHaveBeenCalledWith({ ...defaults, needMyAction: true });
  },
};

/**
 * Need My Action on: the Steps I hold, the Steps not picked up of my pool, and my
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

/** 42 items in all, 25 a page. */
const longList = { ...list, stages: list.stages.map((s) => ({ ...s, count: s.key === "pending_approval" ? 36 : s.count })) };
const pager = (context: PlayContext) => within(context.canvas.getByRole("navigation", { name: storyText(context, copy.pages) }));

/** The first page, as the design draws it: rows per page, "Page 1 of 2 · 42 submittals", « ‹ 1 2 › ». */
export const FirstPage: Story = {
  args: { query: { ...defaults, page: 1, pageSize: 25 }, list: { ...longList, page: { number: 1, size: 25, hasNext: true } } },
  play: async (context) => {
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.firstPage) })).toBeNull();
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.previousPage) })).toBeNull();
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.nextPage) })).toHaveAttribute("href", "?page=2&pageSize=25");
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.lastPage) })).toHaveAttribute("href", "?page=2&pageSize=25");
    await expect(pager(context).getByRole("link", { name: storyText(context, b("Page 2", "صفحة 2")) })).toBeVisible();
    await expect(pager(context).getByText(storyText(context, b("Page 1 of 2 · 42 items", "صفحة 1 من 2 · 42 عناصر")))).toBeVisible();
  },
};

/** Rows per page: 10, 25 or 50; another size asks for the first page of it. */
export const RowsPerPage: Story = {
  args: { query: { ...defaults, page: 2, pageSize: 25 }, list: { ...longList, page: { number: 2, size: 25, hasNext: false } } },
  play: async (context) => {
    await userEvent.selectOptions(pager(context).getByLabelText(storyText(context, b("Rows per page", "صفوف في الصفحة"))), "10");
    await expect(context.args.onQueryChange).toHaveBeenLastCalledWith({ ...defaults, pageSize: 10 });
  },
};

/** A later page: back to the first and the one before, the numbered pages around it, its filters kept. */
export const Paged: Story = {
  args: {
    query: { ...defaults, stage: ["pending_approval"], page: 3, pageSize: 10 },
    list: { ...longList, page: { number: 3, size: 10, hasNext: true } },
  },
  play: async (context) => {
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.firstPage) })).toHaveAttribute("href", "?stage=pending_approval&page=1&pageSize=10");
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.previousPage) })).toHaveAttribute("href", "?stage=pending_approval&page=2&pageSize=10");
    await expect(pager(context).getByText(storyText(context, b("Page 3 of 5 · 42 items", "صفحة 3 من 5 · 42 عناصر")))).toBeVisible();
    await expect(pager(context).getByRole("link", { name: storyText(context, copy.lastPage) })).toHaveAttribute("href", "?stage=pending_approval&page=5&pageSize=10");
  },
};

/** Under a search there is no total ("Search and filters"): the page alone, no last page, and the numbers read so far and the next. */
export const PagedUnderASearch: Story = {
  args: { query: { ...defaults, q: "LED", page: 2, pageSize: 10 }, list: { ...longList, page: { number: 2, size: 10, hasNext: true } } },
  play: async (context) => {
    await expect(pager(context).getAllByText(storyText(context, b("Page 2", "صفحة 2")), { exact: true })[0]).toBeVisible();
    await expect(pager(context).queryByText(/42/)).toBeNull();
    await expect(pager(context).queryByRole("link", { name: storyText(context, copy.lastPage) })).toBeNull();
    await expect(pager(context).getByRole("link", { name: storyText(context, b("Page 3", "صفحة 3")) })).toHaveAttribute("href", "?q=LED&page=3&pageSize=10");
    await expect(pager(context).queryByRole("link", { name: storyText(context, b("Page 4", "صفحة 4")) })).toBeNull();
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
  args: { query: { ...defaults, stage: ["pending_approval"], page: 2 } },
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
    await expect(within(tableOf(context)).getAllByRole("row")).toHaveLength(2);
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
