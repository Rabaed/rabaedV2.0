import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { Icon, directionalIconNames, iconNames } from "./icon.tsx";

const meta = {
  title: "Components/Icon",
  component: Icon,
  args: { name: "search" },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** An icon is mirrored when it renders flipped on the horizontal axis. */
function isMirrored(icon: Element) {
  const { scale, transform } = getComputedStyle(icon);
  return scale.startsWith("-1") || transform.startsWith("matrix(-1");
}

function iconIn(context: PlayContext, testId: string) {
  return context.canvas.getByTestId(testId).querySelector("svg")!;
}

/** Decorative by default: hidden from assistive tech, painted in the text colour. */
export const Decorative: Story = {
  render: (args) => (
    <span data-testid="icon" className="text-brand-fg">
      <Icon {...args} />
    </span>
  ),
  play: async (context) => {
    const svg = iconIn(context, "icon");
    await expect(svg).toHaveAttribute("aria-hidden", "true");
    await expect(getComputedStyle(svg).stroke).toBe(getComputedStyle(context.canvas.getByTestId("icon")).color);
  },
};

/** With a `label`, the icon stands alone and is announced as an image. */
export const Labelled: Story = {
  args: { name: "alert-triangle" },
  render: (args, context) => <Icon {...args} label={storyText(context, { en: "Warning", ar: "تنبيه" })} />,
  play: async (context) => {
    const name = storyText(context, { en: "Warning", ar: "تنبيه" });
    await expect(context.canvas.getByRole("img", { name })).toBeVisible();
  },
};

const directional = iconNames.filter((name) => directionalIconNames.has(name));
// Every other icon keeps its drawing in Arabic, including vertical arrows and chevrons.
const fixed = iconNames.filter((name) => !directionalIconNames.has(name));

/** Arrows and chevrons point the reading way: flipped in Arabic. Other icons never flip. */
export const Direction: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {[...directional, ...fixed].map((name) => (
        <span key={name} data-testid={name} className="inline-flex items-center gap-1 text-caption text-muted">
          <Icon name={name} />
          <span dir="ltr">{name}</span>
        </span>
      ))}
      <span data-testid="opt-out" className="inline-flex items-center gap-1 text-caption text-muted">
        <Icon name="arrow-right" mirrorInRtl={false} />
        <span dir="ltr">arrow-right, mirrorInRtl=false</span>
      </span>
    </div>
  ),
  play: async (context) => {
    const rtl = storyLocale(context) === "ar";
    for (const name of directional) await expect({ name, mirrored: isMirrored(iconIn(context, name)) }).toEqual({ name, mirrored: rtl });
    for (const name of fixed) await expect({ name, mirrored: isMirrored(iconIn(context, name)) }).toEqual({ name, mirrored: false });
    await expect(isMirrored(iconIn(context, "opt-out"))).toBe(false);
  },
};

/** Every icon in the set. To add one, register it in icon.tsx. */
export const Gallery: Story = {
  render: () => (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
      {iconNames.map((name) => (
        <li key={name} className="flex items-center gap-2 text-text">
          <Icon name={name} />
          <span dir="ltr" className="text-caption text-muted">
            {name}
          </span>
        </li>
      ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll("svg")).toHaveLength(iconNames.length);
  },
};
