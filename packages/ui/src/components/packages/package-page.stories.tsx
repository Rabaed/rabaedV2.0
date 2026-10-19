import { defaultOutcomeSets, type PackageDetail, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { packagePageLabels } from "../../storybook/packages.ts";
import { PackagePage, type PackagePageProps } from "./package-page.tsx";
import type { PackageItemSearch } from "./add-package-items-dialog.tsx";
import type { SubmitPackageCall } from "./submit-package-dialog.tsx";

// The Package page (RP-659; spec RP-616; the RP-633 reference as corrected by
// design/prompts/packages.md): Al Futtaim's PM building an Open Package, the same Package
// In Progress, a Consultant reading it (no actions), a Done one, and the dialogs. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const labelsOf = (context: { globals: Record<string, unknown> }) => packagePageLabels[storyLocale(context)];

const ownCompany = b("Al Futtaim Contracting", "شركة الفطيم للمقاولات");
const consultant = b("Design Consultants", "المستشارون للتصميم");
const stages = {
  draft: { key: "draft", name: b("Draft", "مسودة"), category: "draft" as const },
  internal: { key: "internal_review", name: b("Internal Review", "مراجعة داخلية"), category: "in_progress" as const },
  pending: { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const },
  approved: { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const },
};
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") };
const mechanical = { id: "00000000-0000-4000-8000-0000000000e2", code: "ME", name: b("Mechanical Works", "أعمال ميكانيكية") };
const mar = { code: "MAR", name: b("Material Approval Request", "طلب اعتماد مواد") };
const sar = { code: "SAR", name: b("Supplier Approval Request", "طلب اعتماد مورّد") };
const reviewStep = { key: "internal_review", name: b("Contractor review", "مراجعة المقاول") };
const pm = { key: "project_manager", name: b("Project Manager", "مدير المشروع"), sort: 2 };
const me = { name: b("Ahmed bin Said", "أحمد بن سعيد"), isMe: true };

const pkgId = "00000000-0000-4000-8000-0000000000f1";
const row = (n: number, rest: Partial<WorkItemRow>): WorkItemRow => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title: "",
  documentNumber: `TWR-MAR-AFC-00${n}`,
  revisionNo: 0,
  stage: stages.pending,
  trade: electrical,
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  submissionDate: "2026-09-01T09:00:00.000Z",
  creationDate: "2026-09-01T09:00:00.000Z",
  with: { kind: "company", companyName: consultant },
  raiserCompanyName: ownCompany,
  package: { id: pkgId, number: "PKG-001", name: b("Bathrooms – Tower 1", "الحمامات – البرج 1") },
  ...rest,
});
const draftOf = (n: number, title: string, rest: Partial<WorkItemRow> = {}) =>
  row(n, {
    title,
    documentNumber: null,
    stage: stages.draft,
    stepEnteredAt: null,
    stepAgeWeeks: null,
    submissionDate: null,
    creationDate: null,
    with: { kind: "own", companyName: ownCompany, step: { key: "draft", name: b("Draft", "مسودة") }, holder: me, role: null },
    ...rest,
  });
const tiles = draftOf(11, "Floor tiles");
const ware = draftOf(12, "Sanitary ware", { trade: mechanical });
const mixer = row(13, {
  title: "Mixer taps",
  type: sar,
  documentNumber: null,
  submissionDate: null,
  creationDate: null,
  stage: stages.internal,
  stepAgeWeeks: 2,
  with: { kind: "own", companyName: ownCompany, step: reviewStep, holder: null, role: { position: pm, projectRole: b("Contractor", "المقاول") } },
});
const lights = row(14, { title: "Mirror lights", stepAgeWeeks: 5 });
const fans = row(15, { title: "Extract fans", trade: mechanical, stage: stages.approved, outcome: "A", stepAgeWeeks: null, with: null, closedBy: { kind: "company", companyName: consultant } });

const name = b("Bathrooms – Tower 1", "الحمامات – البرج 1");
const openPkg: PackageDetail = {
  id: pkgId,
  projectId: "00000000-0000-4000-8000-000000000100",
  number: "PKG-001",
  name,
  status: "open",
  owner: { participantId: "00000000-0000-4000-8000-0000000000a1", companyName: ownCompany },
  counts: { total: 3, open: 3, codes: {} },
  items: [],
  actions: { rename: true, addItems: true, removeItems: true, delete: true, submit: true },
};
const inProgress: PackageDetail = {
  ...openPkg,
  status: "in_progress",
  counts: { total: 4, open: 3, codes: { A: 1 } },
  actions: { rename: true, addItems: true, removeItems: false, delete: false, submit: true },
};
// Another Company (the Consultant) reads it and changes nothing.
const asConsultant: PackageDetail = { ...inProgress, counts: { total: 3, open: 2, codes: { A: 1 } }, actions: { rename: false, addItems: false, removeItems: false, delete: false, submit: false } };
const done: PackageDetail = { ...inProgress, status: "done", counts: { total: 2, open: 0, codes: { A: 1, B: 1 } }, actions: { ...inProgress.actions, submit: false } };

const filters: PackagePageProps["filters"] = {
  outcomes: [...defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })), ...defaultOutcomeSets.review_code.map((o) => ({ ...o, type: sar.code }))],
  locations: [],
  trades: [electrical, mechanical],
};

const ok = async () => ({ ok: true as const });
const found: WorkItemRow[] = [
  // In no Package yet.
  draftOf(21, "Shower screens", { package: undefined }),
  draftOf(22, "Grab rails", { package: { id: "00000000-0000-4000-8000-0000000000f2", number: "PKG-002", name: b("Accessible WCs", "دورات مياه ميسّرة") } }),
  tiles,
];
const search: PackageItemSearch = async () => found;

const meta = {
  title: "Packages/PackagePage",
  component: PackagePage,
  args: {
    pkg: openPkg,
    rows: [tiles, ware, mixer],
    filters,
    locale: "en",
    labels: packagePageLabels.en,
    backHref: "#submittals",
    itemHref: (id: string) => `#${id}`,
    onRename: fn(ok),
    onDelete: fn(ok),
    onRemove: fn(ok),
    searchItems: fn(search),
    onAdd: fn(ok),
    onSubmit: fn<SubmitPackageCall>(async () => ({ ok: true, submitted: 3 })),
  },
  render: (args, context) => <PackagePage {...args} locale={storyLocale(context)} labels={labelsOf(context)} />,
  decorators: [(Story) => <div className="max-w-[1100px] bg-canvas p-6">{Story()}</div>],
} satisfies Meta<typeof PackagePage>;

export default meta;
type Story = StoryObj<typeof meta>;

const actionsOf = (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }) =>
  context.canvas.getByRole("group", { name: labelsOf(context).actions });

/**
 * The Contractor PM's Open Package being built: PKG-001 left to right beside Al Futtaim, its name,
 * Open, the counts of what they see, and its three submittals with Step Age dots and no dates.
 * Rename, Delete, Add items and Submit Package; each row can be removed.
 */
export const OpenPackage: Story = {
  play: async (context) => {
    const { canvas } = context;
    const locale = storyLocale(context);
    const l = labelsOf(context);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(name[locale]);
    const number = context.canvasElement.querySelector<HTMLElement>("[data-package-number]")!;
    await expect(number).toHaveTextContent("PKG-001");
    await expect(number).toHaveAttribute("dir", "ltr");
    await expectLaidOutLeftToRight(number);
    // The owning Company beside the number.
    const owner = canvas.getByText(ownCompany[locale]);
    await expect(Math.abs(owner.getBoundingClientRect().top - number.getBoundingClientRect().top)).toBeLessThan(12);
    await expect(context.canvasElement.querySelector("[data-package-status]")).toHaveTextContent(l.status.open);
    for (const action of [l.rename.trigger, l.delete.trigger, l.addItems.trigger, l.submit.trigger]) {
      await expect(within(actionsOf(context)).getByRole("button", { name: action })).toBeVisible();
    }
    const table = canvas.getByRole("table", { name: l.table.table });
    await expect(within(table).getAllByRole("row")).toHaveLength(4);
    await expect(within(table).getByRole("columnheader", { name: new RegExp(l.with) })).toBeVisible();
    await expect(canvas.getByText(l.closedOf("0", "3"))).toBeInTheDocument();
    await expect(context.canvasElement.querySelector('[data-code="open"]')).toHaveTextContent("3");
  },
};

/** Removing a row (while Open) calls the API for that submittal. */
export const RemoveItem: Story = {
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("button", { name: labelsOf(context).remove(ware.title) }));
    await expect(context.args.onRemove).toHaveBeenCalledWith(ware);
  },
};

/** In Progress: items are added and it is renamed, never an item removed nor the Package deleted. */
export const InProgress: Story = {
  args: { pkg: inProgress, rows: [lights, fans, mixer, tiles] },
  play: async (context) => {
    const l = labelsOf(context);
    const actions = within(actionsOf(context));
    await expect(actions.queryByRole("button", { name: l.delete.trigger })).toBeNull();
    await expect(actions.getByRole("button", { name: l.addItems.trigger })).toBeVisible();
    await expect(context.canvas.queryByRole("button", { name: l.remove(tiles.title) })).toBeNull();
    // Two still to Submit (the Draft and the one at internal review): Submit Package stays.
    await expect(actions.getByRole("button", { name: l.submit.trigger })).toBeVisible();
    await expect(context.canvasElement.querySelector('[data-code="A"]')).toHaveTextContent("1");
    await expect(context.canvas.getByText(l.closedOf("1", "4"))).toBeInTheDocument();
  },
};

/** Nothing left to Submit: Submit Package is gone. */
export const NothingLeftToSubmit: Story = {
  args: { pkg: { ...inProgress, actions: { ...inProgress.actions, submit: false } }, rows: [lights, fans] },
  play: async (context) => {
    await expect(context.canvas.queryByRole("button", { name: labelsOf(context).submit.trigger })).toBeNull();
  },
};

/** The Consultant reads it: its counts and items as they see them, by Company name only, and no action at all. */
export const ReadByAnotherCompany: Story = {
  args: { pkg: asConsultant, rows: [lights, fans, mixer] },
  play: async (context) => {
    await expect(within(actionsOf(context)).queryAllByRole("button")).toHaveLength(0);
    await expect(context.canvas.queryByRole("button", { name: /Remove|إزالة/ })).toBeNull();
  },
};

/**
 * The item table (RP-660, story 34 and 38): each submittal the viewer sees with its Document Number
 * left to right, Subject, Trade, who it is With (another Company by its name, V14) and its Review
 * Code; its Subject opens the item, where its Transitions are taken.
 */
export const ItemTable: Story = {
  args: { pkg: asConsultant, rows: [lights, fans, mixer] },
  play: async (context) => {
    const locale = storyLocale(context);
    const l = labelsOf(context);
    const table = context.canvas.getByRole("table", { name: l.table.table });
    for (const column of [l.table.columns.documentNumber, l.table.columns.subject, l.table.columns.trade, l.with, l.table.columns.outcome]) {
      await expect(within(table).getByRole("columnheader", { name: new RegExp(escaped(column)) })).toBeVisible();
    }
    const lightsRow = within(table).getByRole("link", { name: lights.title }).closest("tr")!;
    await expect(within(table).getByRole("link", { name: lights.title })).toHaveAttribute("href", `#${lights.id}`);
    await expect(within(lightsRow).getByText(consultant[locale])).toBeVisible();
    await expect(lightsRow).toHaveTextContent(electrical.name[locale]);
    const number = within(lightsRow).getByText(lights.documentNumber!);
    await expect(number.closest("[dir=ltr]")).not.toBeNull();
    const fansRow = within(table).getByRole("link", { name: fans.title }).closest("tr")!;
    await expect(fansRow).toHaveTextContent(l.table.code("A"));
  },
};

/** Done: says so; nothing to Submit. */
export const Done: Story = {
  args: { pkg: done, rows: [fans, row(16, { title: "Basins", stage: stages.approved, outcome: "B", stepAgeWeeks: null, with: null })] },
  play: async (context) => {
    const l = labelsOf(context);
    await expect(context.canvas.getByRole("note")).toHaveTextContent(l.done);
    await expect(context.canvasElement.querySelector("[data-package-status]")).toHaveTextContent(l.status.done);
    await expect(context.canvas.queryByRole("button", { name: l.submit.trigger })).toBeNull();
  },
};

/** A new Open Package with nothing in it yet. */
export const Empty: Story = {
  args: { pkg: { ...openPkg, counts: { total: 0, open: 0, codes: {} }, actions: { ...openPkg.actions, submit: false } }, rows: [] },
  play: async (context) => {
    await expect(context.canvas.getByText(labelsOf(context).empty)).toBeVisible();
    await expect(context.canvas.queryByRole("button", { name: labelsOf(context).submit.trigger })).toBeNull();
  },
};

/** Submit Package asks first, listing what it Submits; a Draft gets its number on submit. */
export const SubmitConfirm: Story = {
  parameters: overlay,
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.submit.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.submit.title("PKG-001") });
    await expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    await expect(within(dialog).getAllByText(l.submit.numberOnSubmit)).toHaveLength(3);
    await expect(context.args.onSubmit).not.toHaveBeenCalled();
  },
};

/** Confirmed and taken: the pop-up closes. */
export const SubmitTaken: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.submit.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.submit.title("PKG-001") });
    await userEvent.click(within(dialog).getByRole("button", { name: l.submit.confirm }));
    await expect(context.args.onSubmit).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/**
 * Not ready: nothing is Submitted; the pop-up names each submittal the viewer sees that stops it,
 * with why and a link to it, says one they don't see stops it too (never which), and Submit stays disabled.
 */
export const SubmitNotReady: Story = {
  parameters: overlay,
  args: {
    onSubmit: fn<SubmitPackageCall>(async () => ({
      ok: false,
      reason: "package_not_ready",
      notReady: [
        { id: tiles.id, documentNumber: null, title: tiles.title, reason: "form_incomplete" },
        { id: mixer.id, documentNumber: null, title: mixer.title, reason: "pick_up_first" },
      ],
      othersNotReady: true,
    })),
  },
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.submit.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.submit.title("PKG-001") });
    await userEvent.click(within(dialog).getByRole("button", { name: l.submit.confirm }));
    const list = await within(dialog).findByRole("alert");
    await expect(within(list).getByRole("link", { name: new RegExp(tiles.title) })).toHaveAttribute("href", `#${tiles.id}`);
    await expect(list).toHaveTextContent(l.submit.reasons.form_incomplete);
    await expect(list).toHaveTextContent(l.submit.reasons.pick_up_first);
    await expect(list).toHaveTextContent(l.submit.othersNotReady);
    await expect(within(dialog).getByRole("button", { name: l.submit.confirm })).toBeDisabled();
  },
};

/** Rename: both names, English and Arabic, saved together. */
export const Rename: Story = {
  parameters: overlay,
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.rename.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.rename.title });
    const en = within(dialog).getByRole("textbox", { name: new RegExp(escaped(l.rename.nameEn)) });
    await expect(en).toHaveValue(name.en);
    await expect(within(dialog).getByRole("textbox", { name: new RegExp(escaped(l.rename.nameAr)) })).toHaveValue(name.ar);
    await userEvent.clear(en);
    await userEvent.click(within(dialog).getByRole("button", { name: l.rename.save }));
    // Both names are needed.
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(l.rename.required);
    await expect(context.args.onRename).not.toHaveBeenCalled();
    await userEvent.type(en, "Bathrooms – Tower 2");
    await userEvent.click(within(dialog).getByRole("button", { name: l.rename.save }));
    await expect(context.args.onRename).toHaveBeenCalledWith({ en: "Bathrooms – Tower 2", ar: name.ar });
  },
};

/** Delete (while Open) asks first, saying its submittals stay. Left open for the screenshot. */
export const Delete: Story = {
  parameters: overlay,
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.delete.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.delete.title("PKG-001") });
    await expect(dialog).toHaveTextContent(l.delete.description);
    await expect(context.args.onDelete).not.toHaveBeenCalled();
  },
};

/** Delete confirmed: the API is called, and the pop-up closes. */
export const DeleteConfirmed: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.delete.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.delete.title("PKG-001") });
    await userEvent.click(within(dialog).getByRole("button", { name: l.delete.confirm }));
    await expect(context.args.onDelete).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/**
 * Add items: the PM's own submittals; one in another Package is marked "In PKG-002" and can't be
 * picked; one already here says so. The chosen ones are added together.
 */
export const AddItems: Story = {
  parameters: overlay,
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.addItems.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.addItems.title });
    const results = await within(dialog).findByRole("list", { name: l.addItems.results });
    await expect(within(results).getByRole("checkbox", { name: l.addItems.choose("Grab rails") })).toBeDisabled();
    await expect(results).toHaveTextContent(l.addItems.inOther("PKG-002"));
    await expect(results).toHaveTextContent(l.addItems.inThis);
    const add = within(dialog).getByRole("button", { name: l.addItems.add("0", 0) });
    await expect(add).toBeDisabled();
    await userEvent.click(within(results).getByRole("checkbox", { name: l.addItems.choose("Shower screens") }));
    await expect(within(dialog).getByRole("button", { name: l.addItems.add("1", 1) })).toBeEnabled();
    await expect(context.args.searchItems).toHaveBeenCalledWith({ q: "", trade: null });
  },
};

/** Added: the API is called with the chosen ones, and the pop-up closes. */
export const AddItemsTaken: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    await userEvent.click(context.canvas.getByRole("button", { name: l.addItems.trigger }));
    const dialog = await screen.findByRole("dialog", { name: l.addItems.title });
    const results = await within(dialog).findByRole("list", { name: l.addItems.results });
    await userEvent.click(within(results).getByRole("checkbox", { name: l.addItems.choose("Shower screens") }));
    await userEvent.click(within(dialog).getByRole("button", { name: l.addItems.add("1", 1) }));
    await expect(context.args.onAdd).toHaveBeenCalledWith([found[0]!.id]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};
