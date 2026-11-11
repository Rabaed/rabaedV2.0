import type { NumberingCounter, NumberingPattern } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { useState, type ReactNode } from "react";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { phone, tablet } from "../../storybook/form.ts";
import { touchTargetOffenders } from "../../storybook/touch-target.ts";
import { ActionBarContext } from "../shell/action-bar.tsx";
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

/** A phone's page with AppShell's bottom action bar under it (RP-1272), as the app gives it to the page. */
function WithActionBar({ children }: { children: ReactNode }) {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  return (
    <div className="flex min-h-dvh flex-col">
      <ActionBarContext.Provider value={{ bar }}>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </ActionBarContext.Provider>
      <div ref={setBar} data-action-bar="" className="sticky bottom-0 z-20 border-t border-border bg-surface px-4 pt-3 pb-3 empty:hidden" />
    </div>
  );
}

/**
 * On a phone (RP-1275) the unsaved changes' Discard and Review & save sit in the bottom action bar, across its
 * width, in place of the bar floating over the page (the Responsive Review: "the save bar spans the width").
 */
export const PhoneSaveInActionBar: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: (args, context) => (
    <WithActionBar>
      <DocumentNumbering {...args} t={numberingText(storyLocale(context))} />
    </WithActionBar>
  ),
  play: async (context) => {
    const { canvas, canvasElement } = context;
    const t = text(context);
    const bar = canvasElement.querySelector<HTMLElement>("[data-action-bar]")!;
    await expect(bar.childElementCount).toBe(0);
    await userEvent.click(canvas.getByRole("button", { name: t("remove", { segment: t("kinds.participant") }) }));
    const unsaved = canvas.getByRole("region", { name: t("unsaved") });
    await expect(bar).toContainElement(unsaved);
    const save = within(unsaved).getByRole("button", { name: t("reviewSave") });
    await expect(within(unsaved).getByRole("button", { name: t("discard") })).toBeVisible();
    // Across the bar, inside its 16 at each side; nothing floats over the page.
    await expect(unsaved.getBoundingClientRect().width).toBe(innerWidth - 32);
    await expect(getComputedStyle(unsaved).position).not.toBe("fixed");
    await expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  },
};

/** Every interactive element at least 44 × 44 px, and no sideways scroll (RP-1288). */
async function expectTouchSized() {
  await expect(touchTargetOffenders(document.body)).toEqual([]);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
}

const chipBoxes = (canvas: ReturnType<typeof within>) => canvas.getAllByTestId("segment-chip").map((chip: HTMLElement) => chip.getBoundingClientRect());

/**
 * On a phone the segments are vertical cards, one under the other across the card (Responsive Anatomy 18,
 * RP-1288), and every control of the pattern editor is a 44-px target. The harness checks the targets too.
 */
export const PatternPhone: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: (args, context) => (
    <WithActionBar>
      <DocumentNumbering {...args} t={numberingText(storyLocale(context))} />
    </WithActionBar>
  ),
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    // A Location and a Fixed text too, so their fields are measured.
    await userEvent.click(canvas.getByRole("button", { name: t("add", { segment: t("kinds.location") }) }));
    await userEvent.click(canvas.getByRole("button", { name: t("add", { segment: t("kinds.text") }) }));
    await expect(canvas.getByRole("combobox", { name: t("level") })).toBeVisible();
    await expect(canvas.getByRole("textbox", { name: t("text") })).toBeVisible();
    const boxes = chipBoxes(canvas);
    for (const [i, box] of boxes.entries()) {
      // As wide as the first, one under the other.
      await expect(Math.round(box.width)).toBe(Math.round(boxes[0]!.width));
      if (i > 0) await expect(box.top).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom);
    }
    // The separator sits between the codes in the number, not between the cards.
    for (const separator of canvas.getByTestId("segment-chips").querySelectorAll("li > span[aria-hidden]")) await expect(separator).not.toBeVisible();
    await expectTouchSized();
  },
};

/** A touch on a segment card, as a finger sends it. */
/** `dy`: that far below the card's middle (negative: above), as a finger passing it is. */
function touch(type: "pointerdown" | "pointermove" | "pointerup", target: EventTarget, at: Element, dy = 0) {
  const box = at.getBoundingClientRect();
  target.dispatchEvent(
    new PointerEvent(type, { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 + dy }),
  );
}

/**
 * On a phone a long press lifts a segment and the finger carries it to its place (Responsive Anatomy 18,
 * RP-1288), announced as the keyboard's move is. A finger that moves before the press lifts it scrolls instead.
 */
export const PhoneLongPressReorder: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: PatternPhone.render,
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    const name = (chip: Element) => chip.querySelector("[data-segment-grip]")!.getAttribute("aria-label");
    const chips = () => canvas.getAllByTestId("segment-chip");
    // A finger touches what is on the screen.
    canvas.getByTestId("segment-chips").scrollIntoView({ block: "center", behavior: "instant" });
    // Moved straight away: a scroll, nothing lifts.
    touch("pointerdown", chips()[3]!, chips()[3]!);
    touch("pointermove", document, chips()[0]!);
    touch("pointerup", document, chips()[0]!);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(previewNumber(canvas)).toHaveTextContent("TWR-TMC-EL-MAR-");
    // Lifted and let go in place: nothing moved, so nothing is announced.
    touch("pointerdown", chips()[1]!, chips()[1]!);
    await waitFor(() => expect(chips()[1]).toHaveClass("outline-primary"));
    touch("pointerup", document, chips()[1]!);
    await waitFor(() => expect(chips()[1]).not.toHaveClass("outline-primary"));
    await expect(canvas.queryByText(/position/)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 450));
    // Held still: the Work Item Type lifts, and is carried over Trade and Company to the top.
    touch("pointerdown", chips()[3]!, chips()[3]!);
    await waitFor(() => expect(chips()[3]).toHaveClass("outline-primary"));
    touch("pointermove", document, chips()[2]!, -10);
    await waitFor(() => expect(previewNumber(canvas)).toHaveTextContent("TWR-TMC-MAR-EL-"));
    touch("pointermove", document, chips()[0]!, -10);
    await waitFor(() => expect(previewNumber(canvas)).toHaveTextContent("MAR-TWR-TMC-EL-"));
    touch("pointerup", document, chips()[0]!);
    await waitFor(() => expect(chips()[0]).not.toHaveClass("outline-primary"));
    // The finger let go of a carried card: that is no tap, so the moves menu stays shut.
    chips()[0]!.querySelector<HTMLElement>("[data-segment-grip]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(within(document.body).queryByRole("menu")).toBeNull();
    // A press later is a tap again: it opens the moves.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await userEvent.click(chips()[0]!.querySelector<HTMLElement>("[data-segment-grip]")!);
    await expect(await within(document.body).findByRole("menu")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(name(chips()[0]!)).toBe(t("move", { segment: t("kinds.type") }));
    await expect(canvas.getByText(t("moved", { segment: t("kinds.type"), n: 1, total: 4 }))).toBeInTheDocument();
    await expect(canvas.getByTestId("unsaved-bar")).toBeVisible();
  },
};

/**
 * A tap on a segment's ⋮ opens its moves (the owner's (b) on RP-1288, comment 15836): Move up, Move down,
 * Move to top, Move to bottom, those that can't apply disabled. A move is announced as the keyboard's is, and
 * focus comes back to the moved segment's handle.
 */
async function moveMenuPlay(context: Parameters<NonNullable<Story["play"]>>[0]) {
  const { canvas } = context;
  const t = text(context);
  const page = within(document.body);
  const grip = (kind: string) => canvas.getByRole("button", { name: t("move", { segment: t(`kinds.${kind}`) }) });
  const items = [t("moveUp"), t("moveDown"), t("moveTop"), t("moveBottom")];

  // The first segment: up and top can't apply.
  await userEvent.click(grip("project"));
  const first = await page.findByRole("menu", { name: t("move", { segment: t("kinds.project") }) });
  await expect(within(first).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(items);
  await expect(within(first).getByRole("menuitem", { name: t("moveUp") })).toBeDisabled();
  await expect(within(first).getByRole("menuitem", { name: t("moveTop") })).toBeDisabled();
  await expect(within(first).getByRole("menuitem", { name: t("moveDown") })).toBeEnabled();
  await expect(touchTargetOffenders(first)).toEqual([]);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(page.queryByRole("menu")).toBeNull());

  // The last segment before the sequence: down and bottom can't apply.
  await userEvent.click(grip("type"));
  const last = await page.findByRole("menu");
  await expect(within(last).getByRole("menuitem", { name: t("moveDown") })).toBeDisabled();
  await expect(within(last).getByRole("menuitem", { name: t("moveBottom") })).toBeDisabled();
  await userEvent.click(within(last).getByRole("menuitem", { name: t("moveTop") }));
  await waitFor(() => expect(page.queryByRole("menu")).toBeNull());
  await expect(previewNumber(canvas)).toHaveTextContent("MAR-TWR-TMC-EL-");
  await expect(canvas.getByText(t("moved", { segment: t("kinds.type"), n: 1, total: 4 }))).toBeInTheDocument();
  await waitFor(() => expect(grip("type")).toHaveFocus());

  // One step down from the top.
  await userEvent.click(grip("type"));
  await userEvent.click(within(await page.findByRole("menu")).getByRole("menuitem", { name: t("moveDown") }));
  await expect(previewNumber(canvas)).toHaveTextContent("TWR-MAR-TMC-EL-");
  await expect(canvas.getByText(t("moved", { segment: t("kinds.type"), n: 2, total: 4 }))).toBeInTheDocument();
  await expectTouchSized();
}

export const PhoneMoveMenu: Story = {
  parameters: { ...phone, layout: "fullscreen" },
  render: PatternPhone.render,
  play: moveMenuPlay,
};

export const TabletMoveMenu: Story = {
  parameters: { ...tablet, layout: "fullscreen" },
  render: (args, context) => (
    <div className="p-6">
      <DocumentNumbering {...args} t={numberingText(storyLocale(context))} />
    </div>
  ),
  play: moveMenuPlay,
};

/** At 820 the segments stay a wrapping row of chips (Responsive Review 15), every control a 44-px target on touch. */
export const PatternTablet: Story = {
  parameters: { ...tablet, layout: "fullscreen" },
  render: (args, context) => (
    <div className="p-6">
      <DocumentNumbering {...args} t={numberingText(storyLocale(context))} />
    </div>
  ),
  play: async (context) => {
    const { canvas } = context;
    const boxes = chipBoxes(canvas);
    // A row: the second chip beside the first.
    await expect(Math.round(boxes[1]!.top)).toBe(Math.round(boxes[0]!.top));
    await expectTouchSized();
  },
};

/** The drawer's Custom pattern on a phone: the same vertical cards and 44-px targets. */
export const CustomPatternDrawerPhone: Story = {
  parameters: { ...phone, ...overlay },
  play: async (context) => {
    const { canvas } = context;
    const t = text(context);
    await userEvent.click(within(canvas.getAllByTestId("numbering-type-item")[0]!).getByRole("button", { name: t("customize") }));
    const drawer = within(await within(document.body).findByTestId("custom-pattern-drawer"));
    const boxes = drawer.getAllByTestId("segment-chip").map((chip) => chip.getBoundingClientRect());
    await expect(boxes[1]!.top).toBeGreaterThanOrEqual(boxes[0]!.bottom);
    await expect(touchTargetOffenders(drawer.getByTestId("segment-chips").parentElement!.parentElement!)).toEqual([]);
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
