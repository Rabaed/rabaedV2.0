import type { NumberingCounter, NumberingPattern } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { numberingText } from "../../storybook/numbering.ts";
import { expectFocusTrapped, overlay } from "../../storybook/overlay.ts";
import { DocumentNumbering, type DocumentNumberingProps, type NumberingContext } from "./document-numbering.tsx";
import type { SampleContext } from "./numbering-model.ts";

// Project Settings → Document Numbering (RP-412 rebuild; kit
// settings-numbering.html): the states the kit shows, in English and Arabic.
// Story data only: the API decides who may save, and gives counters to Project
// Admins only (visibility.md scenario 55).

const kitPattern: NumberingPattern = {
  segments: [{ kind: "project" }, { kind: "participant" }, { kind: "trade" }, { kind: "type" }],
  separator: "-",
  seqDigits: 3,
  countedBy: [0, 1, 2, 3],
};

const attributes = (code: string | null, ordinal: number | null, tradeCode: string): NumberingContext["attributes"] => ({
  projectCode: "TWR",
  tradeCode,
  participant: { code, ordinal },
  locationPath: ["ZA", "T1", "F01"],
});

const preview: NumberingContext = { label: "TMC Constructions · Electrical", company: "TMC", trade: "Electrical", attributes: attributes("TMC", 1, "EL") };
const samples: SampleContext[] = [
  preview,
  { company: "TMC", trade: "Civil", attributes: attributes("TMC", 1, "CV") },
  { company: "GLF", trade: "Electrical", attributes: attributes("GLF", 2, "EL") },
];
const counters: NumberingCounter[] = [
  { counterKey: "TWR-TMC-EL-MAR", lastValue: 41, startingNumber: null, issued: true },
  { counterKey: "TWR-TMC-CV-MAR", lastValue: 18, startingNumber: null, issued: true },
  { counterKey: "TWR-GLF-EL-MAR", lastValue: 7, startingNumber: null, issued: true },
];

const types: DocumentNumberingProps["types"] = [
  { id: "00000000-0000-4000-8000-000000000401", code: "MAR", name: "Material Approval Request", custom: null },
  {
    id: "00000000-0000-4000-8000-000000000402",
    code: "SAR",
    name: "Shop Drawing",
    custom: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "location", level: 2 }, { kind: "participant" }], separator: "-", seqDigits: 4, countedBy: [1, 2, 3] },
  },
];

const meta = {
  title: "Numbering/DocumentNumbering",
  component: DocumentNumbering,
  args: {
    t: numberingText("en"),
    canEdit: true,
    projectPattern: kitPattern,
    isRabaedDefault: false,
    types,
    preview,
    samples,
    counters,
    tradeCodes: ["EL", "CV"],
    onSave: fn<DocumentNumberingProps["onSave"]>(async () => ({ ok: true as const })),
  },
  render: (args, context) => (
    <div className="flex max-w-[1056px] flex-col gap-4 pb-24">
      <DocumentNumbering {...args} t={numberingText(storyLocale(context))} />
    </div>
  ),
} satisfies Meta<typeof DocumentNumbering>;

export default meta;
type Story = StoryObj<typeof meta>;

const text = (context: { globals: Record<string, unknown> }) => numberingText(storyLocale(context));
const previewNumber = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("numbering-preview")).getByTestId("pattern-number");

/** The kit's default state for a Project Admin: the real next number from the counters, in colour, left to right in both languages. */
export const Default: Story = {
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const number = previewNumber(canvas);
    await expect(number).toHaveTextContent("TWR-TMC-EL-MAR-042");
    await expect(number).toHaveAttribute("dir", "ltr");
    await expectLaidOutLeftToRight(number);
    const next = within(canvas.getByTestId("next-numbers"));
    for (const n of ["TWR-TMC-EL-MAR-042", "TWR-TMC-CV-MAR-019", "TWR-GLF-EL-MAR-008"]) await expect(next.getByText(n)).toBeVisible();
    await expect(canvas.getByText(t("segmentCount", { n: 4, max: 6 }))).toBeVisible();
    // SAR has a Custom pattern, MAR uses the Project pattern.
    const rows = canvas.getAllByTestId("numbering-type-row");
    await expect(within(rows[0]!).getByText(t("usesProject"))).toBeVisible();
    await expect(within(rows[1]!).getByText(t("custom"))).toBeVisible();
    await expect(canvas.queryByTestId("unsaved-bar")).toBeNull();
  },
};

/** Removing the Company segment: the inline warning, the preview counting on one shared counter, and the "Unsaved changes" bar. */
export const NoCompanyWarning: Story = {
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    await userEvent.click(canvas.getByRole("button", { name: t("remove", { segment: t("kinds.participant") }) }));
    const warning = canvas.getByTestId("shared-counter-warning");
    await expect(warning).toHaveTextContent(t("noCompanyTitle"));
    await expect(previewNumber(canvas)).toHaveTextContent("TWR-EL-MAR-");
    await expect(canvas.getByTestId("unsaved-bar")).toHaveTextContent(t("unsaved"));
    // One click puts it back, counted separately again.
    await userEvent.click(within(warning).getByRole("button", { name: t("companySegment") }));
    await expect(canvas.queryByTestId("shared-counter-warning")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: t("remove", { segment: t("kinds.participant") }) }));
  },
};

/** The keyboard moves a segment, as dragging does: arrow keys on its handle, along the reading direction, announced. */
export const KeyboardReorder: Story = {
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const grip = canvas.getByRole("button", { name: t("move", { segment: t("kinds.type") }) });
    grip.focus();
    await userEvent.keyboard("{Home}");
    await expect(previewNumber(canvas)).toHaveTextContent("MAR-TWR-TMC-EL-");
    await expect(canvas.getByRole("button", { name: t("move", { segment: t("kinds.type") }) })).toHaveFocus();
    await expect(canvas.getByText(t("moved", { segment: t("kinds.type"), n: 1, total: 4 }))).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    await expect(previewNumber(canvas)).toHaveTextContent("TWR-MAR-TMC-EL-");
    await expect(canvas.getByTestId("unsaved-bar")).toBeVisible();
  },
};

/**
 * Review & save: before → after, only new items, and, for a pattern without the
 * Company counted, the shared-counter acceptance the database needs; Save stays
 * off until it is ticked, then saves the Project pattern with it accepted.
 */
export const SaveModal: Story = {
  parameters: overlay,
  play: async (context) => {
    const { canvas, args } = context;
    const t = text(context);
    await userEvent.click(canvas.getByRole("button", { name: t("remove", { segment: t("kinds.participant") }) }));
    await userEvent.click(canvas.getByRole("button", { name: t("reviewSave") }));
    const modal = within(await within(document.body).findByTestId("numbering-save-modal"));
    await expect(modal.getByText("TWR-TMC-EL-MAR-042")).toBeVisible();
    await expect(modal.getByTestId("after-number")).toHaveTextContent("TWR-EL-MAR-");
    // As the kit: the Custom patterns saved with it (SAR's), though they don't change.
    await expect(modal.getByText(t("customsSaved", { count: 1, n: 1 }))).toBeVisible();
    const save = modal.getByRole("button", { name: t("saveNew") });
    await expect(save).toBeDisabled();
    await userEvent.click(modal.getByRole("checkbox", { name: t("sharedAccept") }));
    await expect(save).toBeEnabled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Saving sends the changes and says so; the bar goes. */
export const Saved: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const t = text(context);
    await userEvent.click(canvas.getByRole("radio", { name: "5" }));
    await userEvent.click(canvas.getByRole("button", { name: t("reviewSave") }));
    const modal = within(await within(document.body).findByTestId("numbering-save-modal"));
    await expect(modal.queryByTestId("shared-counter-acceptance")).toBeNull();
    await userEvent.click(modal.getByRole("button", { name: t("saveNew") }));
    await expect(args.onSave).toHaveBeenCalledWith([{ workItemTypeId: null, pattern: { ...kitPattern, seqDigits: 5 } }], false);
    await waitFor(() => expect(canvas.queryByTestId("unsaved-bar")).toBeNull());
    await expect(await canvas.findByRole("status")).toHaveTextContent(t("saved"));
  },
};

/** "Customize" on MAR opens its Custom pattern drawer, starting from the Project pattern; Apply marks it Custom. */
export const CustomPatternDrawer: Story = {
  parameters: overlay,
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const mar = canvas.getAllByTestId("numbering-type-row")[0]!;
    await userEvent.click(within(mar).getByRole("button", { name: t("customize") }));
    const drawer = await within(document.body).findByTestId("custom-pattern-drawer");
    await expect(within(drawer).getByRole("heading", { name: t("drawerTitle", { type: "Material Approval Request" }) })).toBeVisible();
    await expect(within(drawer).getAllByTestId("pattern-number")[0]).toHaveTextContent("TWR-TMC-EL-MAR-042");
    await expectFocusTrapped(drawer);
  },
};

/** "Use Project pattern" on SAR takes its Custom pattern away; saving sends it as null. */
export const UseProjectPattern: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    const t = text(context);
    const sar = canvas.getAllByTestId("numbering-type-row")[1]!;
    await userEvent.click(within(sar).getByRole("button", { name: t("useProject") }));
    await expect(within(sar).getByText(t("usesProject"))).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: t("reviewSave") }));
    const modal = within(await within(document.body).findByTestId("numbering-save-modal"));
    await userEvent.click(modal.getByRole("button", { name: t("saveNew") }));
    await expect(args.onSave).toHaveBeenCalledWith([{ workItemTypeId: types[1]!.id, pattern: null }], false);
  },
};

/**
 * A Member who isn't a Project Admin: the same page without controls, and examples
 * from their own Participant counted from 1, never a counter (RP-412-2).
 */
export const ReadOnly: Story = {
  args: { canEdit: false, counters: undefined, samples: [preview, samples[1]!] },
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    await expect(previewNumber(canvas)).toHaveTextContent("TWR-TMC-EL-MAR-001");
    await expect(canvas.queryByTestId("next-numbers")).toBeNull();
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByRole("textbox")).toBeNull();
    await expect(canvas.getByText(t("patternHintReadOnly"))).toBeVisible();
    await expect(canvas.getByRole("columnheader", { name: t("colExample") })).toBeVisible();
  },
};

/**
 * Every number of a Type is built under the pattern in effect for it: with MAR on a
 * Custom pattern without Trade, the preview, Next numbers and revision example are
 * MAR's own, and its counters list no per-Trade counter.
 */
export const PreviewUnderCustomPattern: Story = {
  args: {
    types: [
      {
        ...types[0]!,
        custom: { segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }], separator: "/", seqDigits: 4, countedBy: [0, 1, 2] },
      },
    ],
    counters: [{ counterKey: "TWR-MAR-TMC", lastValue: 6, startingNumber: null, issued: true }],
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(previewNumber(canvas)).toHaveTextContent("TWR/MAR/TMC/0007");
    const next = within(canvas.getByTestId("next-numbers"));
    await expect(next.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["TMCTWR/MAR/TMC/0007", "GLFTWR/MAR/GLF/0001"]);
    await expect(canvas.getByTestId("revision-example")).toHaveTextContent("TWR/MAR/TMC/0007 Rev 1");
  },
};

/** A Project pattern without Trade: one example counter per Company, none per Trade. */
export const CountersFollowTheScope: Story = {
  args: {
    projectPattern: { segments: [{ kind: "project" }, { kind: "participant" }, { kind: "type" }], separator: "-", seqDigits: 3, countedBy: [0, 1, 2] },
    counters: [{ counterKey: "TWR-TMC-MAR", lastValue: 59, startingNumber: null, issued: true }],
  },
  play: async (context) => {
    const { canvas } = context;
    const items = within(canvas.getByTestId("scope-examples")).getAllByRole("listitem");
    await expect(items.map((li) => li.textContent)).toEqual(["TMC→ 060", "GLF→ 001"]);
  },
};

/**
 * A Member whose Participant has no code yet: the Company segment prints a
 * placeholder, never the Participant's order on the Project (RP-381-1).
 */
export const MemberWithoutCode: Story = {
  args: {
    canEdit: false,
    counters: undefined,
    preview: { ...preview, company: "TMC Constructions", attributes: attributes(null, null, "EL") },
    samples: [{ ...preview, company: "TMC Constructions", attributes: attributes(null, null, "EL") }],
  },
  play: async (context) => {
    const { canvas } = context;
    await expect(previewNumber(canvas)).toHaveTextContent("TWR-XX-EL-MAR-001");
    await expect(canvas.getByTestId("numbering-project-pattern")).not.toHaveTextContent(/\b0\d\b/);
  },
};
