import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { StatTile } from "./stat-tile.tsx";

// Home's counts (RP-407): one tile per count, Latin digits in Arabic too. Story data only.
const b = (en: string, ar: string) => ({ en, ar });
const tiles = [
  { icon: "buildings", tone: "brand", value: 3, label: b("Active Projects", "المشاريع النشطة") },
  { icon: "user", tone: "info", value: 12, label: b("Need My Action", "بحاجة لإجرائي") },
  { icon: "clock", tone: "warning", value: 940, label: b("At their step for 4+ weeks", "في خطوتها منذ 4 أسابيع أو أكثر") },
] as const;

const meta = {
  title: "Data/StatTile",
  component: StatTile,
  args: { label: "Active Projects", value: 3, icon: "buildings", locale: "en" },
  render: (_args, context) => (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <StatTile key={t.icon} icon={t.icon} tone={t.tone} value={t.value} label={storyText(context, t.label)} locale={storyLocale(context)} />
      ))}
    </div>
  ),
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three tiles, each its number with what it counts; Latin digits in Arabic too. */
export const Tiles: Story = {
  play: async (context) => {
    for (const t of tiles) await expect(context.canvas.getByText(storyText(context, t.label))).toBeVisible();
    await expect(context.canvas.getByText("12")).toBeVisible();
    await expect(context.canvas.getByText("940")).toBeVisible();
  },
};
