import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { reviewCodes } from "../../tokens/themes.ts";
import { CodeBadge } from "./code-badge.tsx";

const meta = {
  title: "Status/CodeBadge",
  component: CodeBadge,
  args: { code: "a", locale: "en" },
} satisfies Meta<typeof CodeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

const meanings = {
  en: { a: "Approved", b: "Approved with Comments", c: "Revise and Resubmit", d: "Rejected" },
  ar: { a: "معتمد", b: "معتمد مع ملاحظات", c: "يُعدَّل ويُعاد تقديمه", d: "مرفوض" },
};
const icons = { a: "circle-check", b: "message-circle", c: "refresh", d: "circle-x" };
const sizes = ["sm", "md"] as const;
const variants = ["full", "letter"] as const;

/** A, B, C and D: each has its own icon, colour and text, so colour is never the only cue. */
export const Codes: Story = {
  render: (args, context) => (
    <div className="flex flex-wrap gap-2">
      {reviewCodes.map((code) => (
        <CodeBadge key={code} {...args} code={code} locale={storyLocale(context)} />
      ))}
    </div>
  ),
  play: async (context) => {
    const meaning = meanings[storyLocale(context)];
    for (const code of reviewCodes) {
      const badge = context.canvas.getByText(meaning[code]).closest("[data-code]")!;
      await expect(badge).toHaveTextContent(code.toUpperCase());
      await expect(badge.querySelector(`[data-icon=${icons[code]}]`)).not.toBeNull();
    }
  },
};

/**
 * Every size and variant. The letter-only variant keeps the meaning as text
 * for screen readers. Code B always shows the comment icon: its Comments
 * continue in the Snag List.
 */
export const SizesAndVariants: Story = {
  render: (args, context) => (
    <div className="flex flex-col gap-3">
      {sizes.map((size) =>
        variants.map((variant) => (
          <div key={`${size}-${variant}`} data-testid={`${size}-${variant}`} className="flex flex-wrap gap-2">
            {reviewCodes.map((code) => (
              <CodeBadge key={code} {...args} code={code} size={size} variant={variant} locale={storyLocale(context)} />
            ))}
          </div>
        )),
      )}
    </div>
  ),
  play: async (context) => {
    const meaning = meanings[storyLocale(context)];
    for (const size of sizes) {
      for (const variant of variants) {
        const row = context.canvas.getByTestId(`${size}-${variant}`);
        const b = row.querySelector("[data-code=b]")!;
        await expect(b.querySelector("[data-icon=message-circle]")).not.toBeNull();
        await expect(b).toHaveTextContent(meaning.b);
      }
    }
  },
};
