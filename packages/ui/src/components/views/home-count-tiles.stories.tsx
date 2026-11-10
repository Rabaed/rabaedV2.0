import type { Locale } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { StatTile } from "../data/stat-tile.tsx";
import { phone, tablet } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { HomeCountTiles } from "./home-cards.tsx";

// Home's four counts (RP-407) at each width (RP-1276, gap-table rows 30 and 34): on a phone a strip
// that swipes a tile at a time, the first two whole (the owner's Responsive Anatomy, screenshot 11);
// 2 × 2 on a tablet; four across from 1100. The app's own tiles: no due-date or payment counts (CLAUDE.md).
const b = (en: string, ar: string) => ({ en, ar });
const copy = {
  counts: b("Across your Projects", "في مشاريعك"),
  activeProjects: b("Active Projects", "المشاريع النشطة"),
  needMyAction: b("Need My Action", "بحاجة لإجرائي"),
  longAtStep: b("My Company: 4+ weeks at step", "عناصر شركتي في خطوتها 4 أسابيع أو أكثر"),
  waitingWithOthers: b("My Company: waiting with others", "عناصر قدّمتها شركتي، لدى جهات أخرى"),
};

function Tiles({ locale }: { locale: Locale }) {
  const t = (text: { en: string; ar: string }) => text[locale];
  return (
    <HomeCountTiles label={t(copy.counts)}>
      <StatTile icon="buildings" tone="brand" value={12} label={t(copy.activeProjects)} locale={locale} />
      <StatTile icon="user-circle" tone="info" value={44} label={t(copy.needMyAction)} locale={locale} />
      <StatTile icon="clock" tone="danger" value={0} label={t(copy.longAtStep)} locale={locale} />
      <StatTile icon="hourglass" tone="warning" value={96} label={t(copy.waitingWithOthers)} locale={locale} />
    </HomeCountTiles>
  );
}

const meta = {
  title: "Views/HomeCountTiles",
  component: Tiles,
  args: { locale: "en" },
  render: (args, context) => <Tiles {...args} locale={storyLocale(context)} />,
} satisfies Meta<typeof Tiles>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const stripOf = (context: PlayContext) => context.canvas.getByRole("region", { name: storyText(context, copy.counts) });
const tilesOf = (strip: HTMLElement) => Array.from(strip.children) as HTMLElement[];
/** The edge a row starts from: the left in English, the right in Arabic. */
const startOf = (box: DOMRect, rtl: boolean) => (rtl ? box.right : box.left);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** Four across on a desktop, in the app's order. */
export const Desktop: Story = {
  parameters: { wide: true },
  play: async (context) => {
    const tiles = tilesOf(stripOf(context));
    await expect(new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size).toBe(1);
    await expect(tiles[0]).toHaveTextContent(storyText(context, copy.activeProjects));
    await expect(within(tiles[1]!).getByText("44")).toBeVisible();
  },
};

/** A tablet (820): 2 × 2, as the Review's notes say ("2-up on tablet"), no strip. */
export const Tablet: Story = {
  parameters: tablet,
  play: async (context) => {
    const strip = stripOf(context);
    const [a, bb, c, d] = tilesOf(strip).map((t) => t.getBoundingClientRect());
    await expect(Math.round(a!.top)).toBe(Math.round(bb!.top));
    await expect(Math.round(c!.top)).toBe(Math.round(d!.top));
    await expect(c!.top).toBeGreaterThanOrEqual(a!.bottom);
    await expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth);
    // Nothing to scroll, so no extra tab stop.
    await expect(strip).not.toHaveAttribute("tabindex");
  },
};

/**
 * A phone (402): the tiles in one row that swipes, snapping a tile at a time; the first two whole and
 * the third peeking. It starts from the right in Arabic and snaps right to left. The page itself
 * never scrolls sideways, and the strip takes keyboard focus so it can be scrolled without touch.
 */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    const rtl = storyLocale(context) === "ar";
    const strip = stripOf(context);
    const tiles = tilesOf(strip);
    const box = strip.getBoundingClientRect();
    const [first, second, third] = tiles.map((t) => t.getBoundingClientRect());
    // One row.
    await expect(new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size).toBe(1);
    // The first tile at the row's start: the left in English, the right in Arabic.
    await expect(Math.abs(startOf(first!, rtl) - startOf(box, rtl))).toBeLessThanOrEqual(1);
    // The first two whole, the third cut by the strip's end.
    for (const tile of [first!, second!]) {
      await expect(tile.left).toBeGreaterThanOrEqual(box.left - 1);
      await expect(tile.right).toBeLessThanOrEqual(box.right + 1);
    }
    await expect(rtl ? third!.left < box.left : third!.right > box.right).toBe(true);
    // 158 wide, as the Anatomy's cards; the third shows enough to say there is more.
    for (const tile of [first!, second!]) await expect(Math.round(tile.width)).toBe(158);
    await expect(rtl ? third!.right - box.left : box.right - third!.left).toBeGreaterThanOrEqual(24);
    // Snaps a tile at a time.
    await expect(getComputedStyle(strip).scrollSnapType).toBe("x mandatory");
    for (const tile of tiles) await expect(getComputedStyle(tile).scrollSnapAlign).toBe("start");
    // A short swipe towards the end settles on the second tile's start.
    strip.scrollBy({ left: rtl ? -60 : 60, behavior: "instant" });
    await nextFrame();
    await expect(Math.abs(startOf(tiles[1]!.getBoundingClientRect(), rtl) - startOf(strip.getBoundingClientRect(), rtl))).toBeLessThanOrEqual(1);
    strip.scrollTo({ left: 0, behavior: "instant" });
    // The page does not scroll sideways; only the strip does.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    await expect(strip).toHaveAttribute("tabindex", "0");
  },
};
