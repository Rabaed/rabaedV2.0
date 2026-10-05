import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { expectLaidOutLeftToRight } from "../../storybook/bidi.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { DocNo } from "./doc-no.tsx";

const meta = {
  title: "Components/DocNo",
  component: DocNo,
  args: { value: "TWR-TMC-EL-MAR-041" },
} satisfies Meta<typeof DocNo>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** The Document Number is isolated and reads left to right, even inside an Arabic sentence. */
async function expectDocNoLeftToRight({ canvas }: PlayContext, text: string) {
  const docNo = canvas.getByText(text);
  const style = getComputedStyle(docNo);
  await expect(style.direction).toBe("ltr");
  await expect(style.unicodeBidi).toBe("isolate");
  await expectLaidOutLeftToRight(docNo);
}

/** In a sentence: "Submittal TWR-TMC-EL-MAR-041 is with the Consultant." */
export const InASentence: Story = {
  render: (args, context) =>
    storyLocale(context) === "ar" ? (
      <p className="text-body text-text">
        التقديم <DocNo {...args} /> لدى الاستشاري منذ أسبوعين.
      </p>
    ) : (
      <p className="text-body text-text">
        Submittal <DocNo {...args} /> has been with the Consultant for 2 weeks.
      </p>
    ),
  play: async (context) => {
    // The sentence itself follows the page: right to left in Arabic.
    const sentence = context.canvasElement.querySelector("p")!;
    await expect(getComputedStyle(sentence).direction).toBe(storyLocale(context) === "ar" ? "rtl" : "ltr");
    await expectDocNoLeftToRight(context, "TWR-TMC-EL-MAR-041");
  },
};

/**
 * With a revision, worded in the page's language: "Rev 2" in English,
 * "مراجعة 2" in Arabic. The number stays isolated and left to right; the
 * revision follows it in reading order, so on its left in Arabic.
 */
export const WithRevision: Story = {
  args: { value: "TWR-SUB-0000123", rev: 2, locale: "en" },
  render: (args, context) => InASentence.render!({ ...args, locale: storyLocale(context) }, context),
  play: async (context) => {
    const ar = storyLocale(context) === "ar";
    await expectDocNoLeftToRight(context, "TWR-SUB-0000123");
    const number = context.canvas.getByText("TWR-SUB-0000123");
    const docNo = number.parentElement!;
    await expect(docNo.textContent).toBe(ar ? "TWR-SUB-0000123 مراجعة 2" : "TWR-SUB-0000123 Rev 2");
    // The number and its revision are one unit, isolated in the page's direction.
    await expect(getComputedStyle(docNo).unicodeBidi).toBe("isolate");
    await expect(getComputedStyle(docNo).direction).toBe(ar ? "rtl" : "ltr");
    // The revision comes after the number in reading order.
    const revision = document.createRange();
    revision.setStartAfter(number);
    revision.setEndAfter(docNo.lastChild!);
    const numberBox = number.getBoundingClientRect();
    const revisionBox = revision.getBoundingClientRect();
    if (ar) await expect(revisionBox.right).toBeLessThanOrEqual(numberBox.left);
    else await expect(revisionBox.left).toBeGreaterThanOrEqual(numberBox.right);
  },
};

/**
 * A number that starts with digits is the case that scrambles without
 * isolation: in Arabic text "2026-RFI-0007" would show as "RFI-0007-2026".
 */
export const StartingWithDigits: Story = {
  args: { value: "2026-RFI-0007" },
  render: InASentence.render,
  play: (context) => expectDocNoLeftToRight(context, "2026-RFI-0007"),
};

/**
 * A Revision's number as Rabaed issues it (RP-316): the chain's number with
 * " Rev 1". The whole number, suffix included, reads left to right in both
 * languages, as on the paper register.
 */
export const IssuedToARevision: Story = {
  args: { value: "TWR-MAR-CCM-0001 Rev 1" },
  render: InASentence.render,
  play: (context) => expectDocNoLeftToRight(context, "TWR-MAR-CCM-0001 Rev 1"),
};

/** On its own, e.g. in a table cell. */
export const Alone: Story = {
  play: (context) => expectDocNoLeftToRight(context, "TWR-TMC-EL-MAR-041"),
};
