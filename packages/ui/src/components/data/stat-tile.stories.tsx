import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { StatTile } from "./stat-tile.tsx";

// Home's counts (RP-407): the design kit's four tiles in one row, Latin digits in Arabic too. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const tiles = [
  { icon: "buildings", tone: "brand", value: 3, label: b("Active Projects", "المشاريع النشطة") },
  { icon: "user-circle", tone: "info", value: 12, label: b("Need My Action", "بحاجة لإجرائي") },
  { icon: "clock", tone: "danger", value: 940, label: b("Your Company's items at their step for 4+ weeks", "عناصر شركتك في خطوتها منذ 4 أسابيع أو أكثر") },
  { icon: "hourglass", tone: "warning", value: 7, label: b("Submitted by my Company, waiting with others", "قدّمتها شركتي، بانتظار الآخرين") },
] as const;

const meta = {
  title: "Data/StatTile",
  component: StatTile,
  args: { label: "Active Projects", value: 3, icon: "buildings", locale: "en" },
  render: (_args, context) => (
    <div className="grid grid-cols-1 gap-[18px] min-[560px]:grid-cols-2 min-[1100px]:grid-cols-4">
      {tiles.map((t) => (
        <StatTile key={t.icon} icon={t.icon} tone={t.tone} value={t.value} label={storyText(context, t.label)} locale={storyLocale(context)} />
      ))}
    </div>
  ),
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Four tiles, each its number with what it counts; Latin digits in Arabic too. */
export const Tiles: Story = {
  play: async (context) => {
    for (const t of tiles) await expect(context.canvas.getByText(storyText(context, t.label))).toBeVisible();
    await expect(context.canvas.getByText("12")).toBeVisible();
    await expect(context.canvas.getByText("940")).toBeVisible();
  },
};
