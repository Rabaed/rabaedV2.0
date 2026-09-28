import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { AgeDots } from "./age-dots.tsx";

const meta = {
  title: "Status/AgeDots",
  component: AgeDots,
  args: { weeks: 0, locale: "en" },
  render: (args, context) => <AgeDots {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof AgeDots>;

export default meta;
type Story = StoryObj<typeof meta>;

const weeks = [0, 1, 2, 3, 4, 6];
const labels = {
  en: ["0 weeks at this step", "1 week at this step", "2 weeks at this step", "3 weeks at this step", "4 weeks at this step", "6 weeks at this step"],
  ar: [
    "0 أسبوع في هذه الخطوة",
    "أسبوع واحد في هذه الخطوة",
    "أسبوعان في هذه الخطوة",
    "3 أسابيع في هذه الخطوة",
    "4 أسابيع في هذه الخطوة",
    "6 أسابيع في هذه الخطوة",
  ],
};

/**
 * Whole weeks at the current Step: one dot per week, up to 4 (4+), grey
 * turning red. The count is also in words, as the image's name, so colour is
 * never the only cue.
 */
export const Weeks: Story = {
  render: (args, context) => (
    <ul className="flex flex-col gap-3">
      {weeks.map((n) => (
        <li key={n}>
          <AgeDots {...args} weeks={n} locale={storyLocale(context)} />
        </li>
      ))}
    </ul>
  ),
  play: async (context) => {
    const names = labels[storyLocale(context)];
    const dots = [0, 1, 2, 3, 4, 4];
    for (const [i, name] of names.entries()) {
      const age = context.canvas.getByRole("img", { name });
      await expect(age.querySelectorAll("[data-filled]")).toHaveLength(dots[i]!);
      await expect(age.children).toHaveLength(4);
    }
  },
};

/** The first dot sits at the start: left in English, right in Arabic. */
export const FillsFromTheStart: Story = {
  args: { weeks: 1 },
  play: async (context) => {
    const age = context.canvas.getByRole("img");
    const filled = age.querySelector("[data-filled]")!.getBoundingClientRect();
    const box = age.getBoundingClientRect();
    const rtl = getComputedStyle(age).direction === "rtl";
    await expect(rtl ? box.right - filled.right : filled.left - box.left).toBeLessThan(box.width / 4);
  },
};
