import { defaultOutcomeSets, formSchema, type BulkOffer, type PackageDetail, type WorkItemRow } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { actionFormLabels } from "../../storybook/form-engine.ts";
import { packageBulkLabels } from "../../storybook/package-bulk.ts";
import { packagePageLabels } from "../../storybook/packages.ts";
import type { BulkTakeResult, BulkTransitionForm, PackageBulkProps } from "./package-bulk.tsx";
import { PackagePage, type PackagePageProps } from "./package-page.tsx";

// Bulk Transitions on the Package page (RP-661 over RP-646; spec RP-616 stories 39–45; the RP-633
// reference's bulk bar, as corrected by design/prompts/packages.md "Reference (RP-633)"): the
// Consultant's PM selects the submittals waiting on them; when every one offers the same
// Transition with the same Action Form, it is offered once, its Action Form filled once and, when
// it offers "Assign to", one Member for all. All or nothing: a refusal names the item that stopped
// it, with why, as the API says it. There is no signing state: each item is signed as in a single
// Transition, so a Member without a Signature is told so by the refusal. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const labelsOf = (context: { globals: Record<string, unknown> }) => packageBulkLabels[storyLocale(context)];
const pageLabelsOf = (context: { globals: Record<string, unknown> }) => packagePageLabels[storyLocale(context)];

const contractor = b("Al Futtaim Contracting", "شركة الفطيم للمقاولات");
const consultant = b("Design Consultants", "المستشارون للتصميم");
const pending = { key: "pending_approval", name: b("Pending Approval", "بانتظار الاعتماد"), category: "in_progress" as const };
const approved = { key: "approved", name: b("Approved", "معتمد"), category: "closed_positive" as const };
const electrical = { id: "00000000-0000-4000-8000-0000000000e1", code: "EL", name: b("Electrical Works", "أعمال كهربائية") };
const mar = { code: "MAR", name: b("Material Approval Request", "طلب اعتماد مواد") };
const reviewStep = { key: "pm_review", name: b("PM review", "مراجعة مدير المشروع") };
const me = { name: b("Khalid Al Harbi", "خالد الحربي"), isMe: true };
const pkgId = "00000000-0000-4000-8000-0000000000f1";

const row = (n: number, title: string, rest: Partial<WorkItemRow> = {}): WorkItemRow => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  projectId: "00000000-0000-4000-8000-000000000100",
  type: mar,
  title,
  documentNumber: `TWR-MAR-AFC-00${n}`,
  revisionNo: 0,
  stage: pending,
  trade: electrical,
  location: null,
  stepEnteredAt: "2026-09-01T00:00:00.000Z",
  stepAgeWeeks: 1,
  outcome: null,
  submissionDate: "2026-09-01T09:00:00.000Z",
  creationDate: "2026-09-01T09:00:00.000Z",
  with: { kind: "own", companyName: consultant, step: reviewStep, holder: me, role: null },
  raiserCompanyName: contractor,
  package: { id: pkgId, number: "PKG-001", name: b("Bathrooms – Tower 1", "الحمامات – البرج 1") },
  ...rest,
});
const tiles = row(11, "Floor tiles");
const ware = row(12, "Sanitary ware");
const lights = row(13, "Mirror lights", { stepAgeWeeks: 3 });
// At the PM's review too, but its Transition shows another Screen Version.
const fans = row(14, "Extract fans");
// Closed: it waits on nobody.
const basins = row(15, "Basins", { stage: approved, outcome: "A", stepAgeWeeks: null, with: null, closedBy: { kind: "company", companyName: consultant } });

const codes: BulkOffer[] = [
  { key: "approve_a", label: b("Code A", "الرمز A"), form: "screen:pm-1" },
  { key: "approve_b", label: b("Code B", "الرمز B"), form: "screen:pm-1" },
  { key: "revise_c", label: b("Code C", "الرمز C"), form: "screen:pm-1" },
];
const otherScreen: BulkOffer[] = codes.map((c) => ({ ...c, form: "screen:pm-2" }));
const itemOf = (r: WorkItemRow, bulkTransitions: BulkOffer[]) => ({
  id: r.id,
  documentNumber: r.documentNumber,
  title: r.title,
  trade: r.trade,
  with: r.with,
  outcome: r.outcome,
  bulkTransitions,
});

const pkg: PackageDetail = {
  id: pkgId,
  projectId: "00000000-0000-4000-8000-000000000100",
  number: "PKG-001",
  name: b("Bathrooms – Tower 1", "الحمامات – البرج 1"),
  status: "in_progress",
  owner: { participantId: "00000000-0000-4000-8000-0000000000a1", companyName: contractor },
  counts: { total: 5, open: 4, codes: { A: 1 } },
  items: [itemOf(tiles, codes), itemOf(ware, codes), itemOf(lights, codes), itemOf(fans, otherScreen), itemOf(basins, [])],
  actions: { rename: false, addItems: false, removeItems: false, delete: false, submit: false },
};

const filters: PackagePageProps["filters"] = {
  outcomes: defaultOutcomeSets.review_code.map((o) => ({ ...o, type: mar.code })),
  locations: [],
  trades: [electrical],
};

const remarks = formSchema.parse({
  sections: [{ key: "code", title: b("Code", "الرمز"), fields: [{ key: "remarks", type: "textarea", required: true, maxLength: 2000, label: b("Remarks", "الملاحظات") }] }],
});
const engineers = [
  { memberId: "00000000-0000-4000-8000-0000000000c1", name: b("Sara Al Qahtani", "سارة القحطاني") },
  { memberId: "00000000-0000-4000-8000-0000000000c2", name: b("Omar Haddad", "عمر حداد") },
];
const withAssignTo: BulkTransitionForm = { actionForm: remarks, assignTo: engineers };
const taken = async (): Promise<BulkTakeResult> => ({ ok: true });
const stoppedBy = (reason: string, rest: object = {}) =>
  fn(async (): Promise<BulkTakeResult> => ({ ok: false, reason: "bulk_refused", stoppedBy: { id: ware.id, documentNumber: ware.documentNumber, title: ware.title, reason, ...rest } }));

type Args = PackagePageProps & { loadForm: PackageBulkProps["loadForm"]; onTake: PackageBulkProps["onTake"] };

const meta = {
  title: "Packages/PackageBulk",
  component: PackagePage,
  args: {
    pkg,
    rows: [tiles, ware, lights, fans, basins],
    filters,
    locale: "en",
    labels: packagePageLabels.en,
    backHref: "#submittals",
    itemHref: (id: string) => `#${id}`,
    loadForm: fn(async (): Promise<BulkTransitionForm> => withAssignTo),
    onTake: fn(taken),
  },
  render: ({ loadForm, onTake, ...args }, context) => {
    const locale = storyLocale(context);
    return (
      <PackagePage
        {...args}
        locale={locale}
        labels={pageLabelsOf(context)}
        bulk={{ labels: packageBulkLabels[locale], actionFormLabels: actionFormLabels[locale], loadForm, onTake }}
      />
    );
  },
  decorators: [(Story) => <div className="max-w-[1100px] bg-canvas p-6">{Story()}</div>],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

const tableOf = (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }) =>
  context.canvas.getByRole("table", { name: pageLabelsOf(context).table.table });
const bulkBar = (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }) => context.canvas.getByRole("toolbar", { name: labelsOf(context).bar });
const select = async (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }, ...rows: WorkItemRow[]) => {
  for (const r of rows) await userEvent.click(within(tableOf(context)).getByRole("checkbox", { name: labelsOf(context).selectRow(r.title) }));
};
const openCodeA = async (context: { canvas: ReturnType<typeof within>; globals: Record<string, unknown> }) => {
  const locale = storyLocale(context);
  await select(context, tiles, ware, lights);
  await userEvent.click(within(bulkBar(context)).getByRole("button", { name: codes[0]!.label[locale] }));
  return screen.findByRole("dialog", { name: codes[0]!.label[locale] });
};

/**
 * Only the submittals waiting on the PM can be selected; the closed one has no checkbox. Selected,
 * the bar counts them and offers the Transitions they all share. Adding one whose Transition shows
 * another Action Form leaves nothing shared, and the bar says so.
 */
export const Selection: Story = {
  play: async (context) => {
    const l = labelsOf(context);
    const locale = storyLocale(context);
    const table = within(tableOf(context));
    await expect(bulkBar(context)).toHaveTextContent(l.hint);
    await expect(table.queryByRole("checkbox", { name: l.selectRow(basins.title) })).toBeNull();
    await select(context, tiles, ware);
    const bar = within(bulkBar(context));
    await expect(bulkBar(context)).toHaveTextContent(l.selected("2", 2));
    for (const code of codes) await expect(bar.getByRole("button", { name: code.label[locale] })).toBeEnabled();
    await select(context, fans);
    await expect(bulkBar(context)).toHaveTextContent(l.selected("3", 3));
    await expect(bulkBar(context)).toHaveTextContent(l.noneShared);
    await expect(bar.queryByRole("button", { name: codes[0]!.label[locale] })).toBeNull();
    await userEvent.click(bar.getByRole("button", { name: l.clear }));
    await expect(bulkBar(context)).toHaveTextContent(l.hint);
    await expect(table.getByRole("checkbox", { name: l.selectRow(tiles.title) })).not.toBeChecked();
  },
};

/** "Select all" picks only the ones waiting on the PM. */
export const SelectAll: Story = {
  args: { pkg: { ...pkg, items: pkg.items.filter((i) => i.id !== fans.id) }, rows: [tiles, ware, lights, basins] },
  play: async (context) => {
    await userEvent.click(within(tableOf(context)).getByRole("checkbox", { name: labelsOf(context).selectAll }));
    await expect(bulkBar(context)).toHaveTextContent(labelsOf(context).selected("3", 3));
  },
};

/** Nothing waits on the viewer (another Company reading it): no checkboxes, no bulk bar. */
export const NothingWaiting: Story = {
  args: { pkg: { ...pkg, items: pkg.items.map((i) => ({ ...i, bulkTransitions: [] })) } },
  play: async (context) => {
    await expect(within(tableOf(context)).queryAllByRole("checkbox")).toHaveLength(0);
    await expect(context.canvas.queryByRole("toolbar", { name: labelsOf(context).bar })).toBeNull();
  },
};

/**
 * The reference screen: three selected and Code A's Action Form open once for them all, with its
 * Remarks, the Internal Note and "Assign to" one Member for all. Left open for the screenshot.
 */
export const ActionFormOpen: Story = {
  parameters: overlay,
  play: async (context) => {
    const l = labelsOf(context);
    const dialog = within(await openCodeA(context));
    await expect(context.args.loadForm).toHaveBeenCalledWith("approve_a", tiles.id);
    await expect(await dialog.findByRole("textbox", { name: /Remarks|الملاحظات/ })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: actionFormLabels[storyLocale(context)].internalNote })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: l.assignTo })).toBeVisible();
    const list = dialog.getByRole("list", { name: l.appliesTo });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    await expect(context.args.onTake).not.toHaveBeenCalled();
  },
};

/** No "Assign to" when the Transition offers none. */
export const WithoutAssignTo: Story = {
  args: { loadForm: fn(async (): Promise<BulkTransitionForm> => ({ actionForm: remarks })) },
  play: async (context) => {
    const dialog = within(await openCodeA(context));
    await dialog.findByRole("textbox", { name: /Remarks|الملاحظات/ });
    await expect(dialog.queryByRole("combobox", { name: labelsOf(context).assignTo })).toBeNull();
  },
};

/**
 * Filled once and taken: the Remarks are checked first, then one request for all three with the same
 * answers and one Member; the pop-up closes and the selection clears.
 */
export const Taken: Story = {
  play: async (context) => {
    const locale = storyLocale(context);
    const l = labelsOf(context);
    const dialog = within(await openCodeA(context));
    const confirm = dialog.getByRole("button", { name: codes[0]!.label[locale] });
    const remarksBox = await dialog.findByRole("textbox", { name: /Remarks|الملاحظات/ });
    await userEvent.click(confirm);
    await expect(await dialog.findByText(l.formInvalid)).toHaveAttribute("role", "alert");
    await expect(context.args.onTake).not.toHaveBeenCalled();
    await userEvent.type(remarksBox, "Approved as submitted.");
    await userEvent.click(dialog.getByRole("combobox", { name: l.assignTo }));
    await userEvent.click(await screen.findByRole("option", { name: engineers[0]!.name[locale] }));
    await userEvent.click(confirm);
    await expect(context.args.onTake).toHaveBeenCalledWith({
      transition: "approve_a",
      workItemIds: [tiles.id, ware.id, lights.id],
      answers: { remarks: "Approved as submitted." },
      internalNote: "",
      assignTo: engineers[0]!.memberId,
      confirmed: true,
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(bulkBar(context)).toHaveTextContent(l.hint);
  },
};

const refuse = async (context: Parameters<NonNullable<Story["play"]>>[0]) => {
  const dialog = within(await openCodeA(context));
  await userEvent.type(await dialog.findByRole("textbox", { name: /Remarks|الملاحظات/ }), "Approved.");
  await userEvent.click(dialog.getByRole("button", { name: codes[0]!.label[storyLocale(context)] }));
  return dialog.findByRole("alert");
};

/**
 * All or nothing, refused: nothing is done, and the pop-up names the item that stopped it, with a
 * link to it, and why. Here the PM has no Signature (RP-85's `no_signature`): each item is signed as
 * in a single Transition. Left open for the screenshot.
 */
export const RefusedNoSignature: Story = {
  parameters: overlay,
  args: { onTake: stoppedBy("no_signature") },
  play: async (context) => {
    const l = labelsOf(context);
    const alert = await refuse(context);
    await expect(alert).toHaveTextContent(l.stoppedTitle);
    await expect(within(alert).getByRole("link", { name: new RegExp(ware.title) })).toHaveAttribute("href", `#${ware.id}`);
    await expect(alert).toHaveTextContent(l.reasons.no_signature!);
  },
};

/** A Validate rule's refusal says why in its own words, in the viewer's language. */
export const RefusedByRule: Story = {
  args: { onTake: stoppedBy("validation_failed", { message: b("Enter the cost impact before you submit.", "أدخل الأثر المالي قبل التقديم.") }) },
  play: async (context) => {
    const alert = await refuse(context);
    await expect(alert).toHaveTextContent(storyLocale(context) === "en" ? "Enter the cost impact before you submit." : "أدخل الأثر المالي قبل التقديم.");
  },
};

/** A reason the page doesn't know yet reads as a sentence, never as its code. */
export const RefusedUnknownReason: Story = {
  args: { onTake: stoppedBy("something_new") },
  play: async (context) => {
    const alert = await refuse(context);
    await expect(alert).toHaveTextContent(labelsOf(context).reasons.unknown);
    await expect(alert).not.toHaveTextContent("something_new");
  },
};
