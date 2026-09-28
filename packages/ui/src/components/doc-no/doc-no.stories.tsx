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

/** With a revision: the Rev stays after the number, on its left-to-right side. */
export const WithRevision: Story = {
  args: { value: "TWR-SUB-0000123", rev: 2 },
  render: InASentence.render,
  play: (context) => expectDocNoLeftToRight(context, "TWR-SUB-0000123 Rev 2"),
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

/** On its own, e.g. in a table cell. */
export const Alone: Story = {
  play: (context) => expectDocNoLeftToRight(context, "TWR-TMC-EL-MAR-041"),
};
