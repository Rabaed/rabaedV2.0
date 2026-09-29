import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { toneKeys } from "../../tokens/themes.ts";
import { Badge } from "./badge.tsx";

const labels = {
  neutral: { en: "Read-only", ar: "للقراءة فقط" },
  brand: { en: "Contractor Engineer", ar: "مهندس المقاول" },
  info: { en: "New", ar: "جديد" },
  success: { en: "Signed", ar: "موقّع" },
  warning: { en: "Unsaved changes", ar: "تغييرات غير محفوظة" },
  danger: { en: "Removed", ar: "محذوف" },
};

const meta = {
  title: "Data/Badge",
  component: Badge,
  args: { children: null },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Neutral and the semantic tones. The text says what the colour means, so colour is never the only cue. */
export const Tones: Story = {
  render: (args, context) => (
    <div className="flex flex-wrap gap-2">
      {toneKeys.map((tone) => (
        <Badge key={tone} {...args} tone={tone}>
          {storyText(context, labels[tone])}
        </Badge>
      ))}
    </div>
  ),
  play: async (context) => {
    for (const tone of toneKeys) await expect(context.canvas.getByText(storyText(context, labels[tone]))).toBeVisible();
  },
};

/** With a leading dot, which is decorative: the badge reads as its text alone. */
export const WithDot: Story = {
  ...Tones,
  args: { dot: true },
  play: async (context) => {
    const badge = context.canvas.getByText(storyText(context, labels.success));
    await expect(badge).toHaveTextContent(new RegExp(`^${storyText(context, labels.success)}$`));
    await expect(badge.querySelector("[aria-hidden=true]")).not.toBeNull();
  },
};

/** The dot sits at the start: left of the text in English, right of it in Arabic. */
export const DotAtStart: Story = {
  args: { dot: true, tone: "info" },
  render: (args, context) => <Badge {...args}>{storyText(context, labels.info)}</Badge>,
  play: async (context) => {
    const badge = context.canvas.getByText(storyText(context, labels.info));
    const dot = badge.querySelector("[aria-hidden=true]")!.getBoundingClientRect();
    const box = badge.getBoundingClientRect();
    const rtl = getComputedStyle(badge).direction === "rtl";
    await expect(rtl ? box.right - dot.right : dot.left - box.left).toBeLessThan(box.width / 3);
  },
};
