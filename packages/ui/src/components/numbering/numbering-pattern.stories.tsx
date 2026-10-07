import { rabaedDefaultNumberingPattern, type NumberingAttributes, type NumberingPattern } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { numberingPatternLabels } from "../../storybook/numbering.ts";
import { NumberingPatternBuilder, NumberingPatternView } from "./numbering-pattern.tsx";

// Project Settings → Numbering (RP-313, spec RP-311): the Project Admin's
// Numbering Pattern builder with its live example and the shared-counter
// warning, and the read-only view every other Project Member gets. Story data
// only: the API decides who may save.

/** A MAR of the Project's first Participant, Electrical, at Floor F2 of Building B1 in Zone Z1. */
const example: NumberingAttributes = {
  projectCode: "TWR",
  typeCode: "MAR",
  tradeCode: "EL",
  participant: { code: null, ordinal: 1 },
  locationPath: ["Z1", "B1", "F2"],
};

/** Fixed text, Trade, the Building level and the Participant Code, '/', 5 digits; counted by all but the text. */
const tradeAndLocation: NumberingPattern = {
  segments: [{ kind: "project" }, { kind: "text", text: "SUB" }, { kind: "trade" }, { kind: "location", level: 2 }, { kind: "participant" }],
  separator: "/",
  seqDigits: 5,
  countedBy: [0, 2, 3, 4],
};

const copy = {
  example: { en: "Example", ar: "مثال" },
  separator: { en: "Separator", ar: "الفاصل" },
  digits: { en: "Sequence digits", ar: "عدد خانات التسلسل" },
  add: { en: "Add segment", ar: "إضافة جزء" },
  counted: { en: "Counted separately", ar: "يُعدّ منفصلًا" },
  save: { en: "Save pattern", ar: "حفظ النمط" },
  shared: { en: "One shared count", ar: "عدّ مشترك واحد" },
  accept: {
    en: "I accept that every Company can tell the others' volume from the gaps",
    ar: "أقبل أن كل شركة تستطيع معرفة حجم عمل الشركات الأخرى من الفجوات",
  },
  segments: { en: "Segments", ar: "الأجزاء" },
  sharedReadOnly: {
    en: "Every Company's items share one count, accepted by the Project Admin.",
    ar: "تشترك بنود كل الشركات في عدّ واحد، بقبول مسؤول المشروع.",
  },
};

type Args = { onSave: (pattern: NumberingPattern, sharedCounterAccepted: boolean) => void };

const meta: Meta<Args> = {
  title: "Settings/NumberingPattern",
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
};

export default meta;
type Story = StoryObj<Args>;

const exampleNumber = (canvasElement: HTMLElement) => within(canvasElement).getByTestId("numbering-example");

/**
 * The Rabaed Default in the builder: the example follows every edit, left to
 * right in both languages, and Save sends the pattern without any acceptance.
 */
export const Builder: Story = {
  args: { onSave: fn() },
  render: (args, context) => (
    <NumberingPatternBuilder locale={storyLocale(context)} labels={numberingPatternLabels[storyLocale(context)]} pattern={rabaedDefaultNumberingPattern} example={example} onSave={args.onSave} />
  ),
  play: async (context) => {
    const { canvas, canvasElement, args } = context;
    const shown = () => exampleNumber(canvasElement).querySelector("bdi")!;
    await expect(shown()).toHaveTextContent("TWR-MAR-01-0001");
    await expect(shown()).toHaveAttribute("dir", "ltr");
    await expect(canvas.queryByText(storyText(context, copy.shared))).toBeNull();

    await userEvent.click(canvas.getByRole("radio", { name: "/" }));
    await userEvent.click(canvas.getByRole("radio", { name: "5" }));
    await expect(shown()).toHaveTextContent("TWR/MAR/01/00001");

    // A new segment is the first kind not yet used: the Trade.
    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.add) }));
    await expect(canvas.getAllByTestId("numbering-segment")).toHaveLength(4);
    await expect(shown()).toHaveTextContent("TWR/MAR/01/EL/00001");

    await userEvent.click(canvas.getByRole("button", { name: storyText(context, copy.save) }));
    await expect(args.onSave).toHaveBeenCalledWith(
      {
        segments: [{ kind: "project" }, { kind: "type" }, { kind: "participant" }, { kind: "trade" }],
        separator: "/",
        seqDigits: 5,
        countedBy: [0, 1, 2],
      },
      false,
    );
  },
};

/**
 * Unticking the Participant Code shows the shared-counter warning; Save stays
 * off until it is accepted, and then sends the acceptance.
 */
export const SharedCounterWarning: Story = {
  args: { onSave: fn() },
  render: (args, context) => (
    <NumberingPatternBuilder locale={storyLocale(context)} labels={numberingPatternLabels[storyLocale(context)]} pattern={rabaedDefaultNumberingPattern} example={example} onSave={args.onSave} />
  ),
  play: async (context) => {
    const { canvas, args } = context;
    const save = canvas.getByRole("button", { name: storyText(context, copy.save) });
    await userEvent.click(canvas.getAllByRole("checkbox", { name: storyText(context, copy.counted) })[2]!);
    const warning = canvas.getByRole("group", { name: storyText(context, copy.shared) });
    await expect(warning).toBeVisible();
    await expect(save).toBeDisabled();

    await userEvent.click(within(warning).getByRole("checkbox", { name: storyText(context, copy.accept) }));
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await expect(args.onSave).toHaveBeenCalledWith({ ...rabaedDefaultNumberingPattern, countedBy: [0, 1] }, true);
  },
};

/** A saved pattern with fixed text, the Trade and a Location level, opened in the builder. */
export const TradeAndLocation: Story = {
  render: (_args, context) => (
    <NumberingPatternBuilder locale={storyLocale(context)} labels={numberingPatternLabels[storyLocale(context)]} pattern={tradeAndLocation} example={example} onSave={fn()} />
  ),
  play: async ({ canvasElement, canvas }) => {
    await expect(exampleNumber(canvasElement)).toHaveTextContent("TWR/SUB/EL/B1/01/00001");
    await expect(canvas.getByRole("textbox")).toHaveValue("SUB");
    await expect(canvas.queryByTestId("shared-counter-warning")).toBeNull();
  },
};

/** What every other Project Member sees: the example and the pattern, nothing to change. */
export const ReadOnly: Story = {
  render: (_args, context) => (
    <NumberingPatternView labels={numberingPatternLabels[storyLocale(context)]} pattern={{ ...tradeAndLocation, countedBy: [0, 2, 3] }} example={example} />
  ),
  play: async (context) => {
    const { canvas, canvasElement } = context;
    await expect(exampleNumber(canvasElement).querySelector("bdi")).toHaveAttribute("dir", "ltr");
    await expect(exampleNumber(canvasElement)).toHaveTextContent("TWR/SUB/EL/B1/01/00001");
    await expect(within(canvas.getByRole("list", { name: storyText(context, copy.segments) })).getAllByRole("listitem")).toHaveLength(5);
    await expect(canvas.getByText(storyText(context, copy.sharedReadOnly))).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvas.queryByRole("checkbox")).toBeNull();
  },
};
