import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { expectTabFocusRing, expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale, storyText } from "../../storybook/locale.ts";
import { BackLink } from "./back-link.tsx";

const back = { en: "Back", ar: "رجوع" };
const title = { en: "SUB-ARC-0012 · Curtain wall shop drawings", ar: "SUB-ARC-0012 · مخططات تنفيذ الواجهة الزجاجية" };
// A fragment, so a click that follows the link stays on the story.
const parent = "#parent";

const meta = {
  title: "Navigation/BackLink",
  component: BackLink,
  render: (args, context) => (
    <div className="flex flex-col gap-1">
      <BackLink {...args} label={storyText(context, back)} />
      <h1 className="font-display text-h3 font-semibold text-text">{storyText(context, title)}</h1>
    </div>
  ),
  args: { href: parent, label: back.en, previousEntry: (): string | null => null, goBack: fn() },
} satisfies Meta<typeof BackLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Opened from an email or in a new tab: no page before in this tab, so "← Back" is a plain link
 * to the page's fixed parent. It is a real link (middle-click opens the parent), Tab reaches it with
 * a focus ring, and its arrow points back: left in English, right in Arabic.
 */
export const ToParent: Story = {
  play: async (context) => {
    const link = context.canvas.getByRole("link", { name: storyText(context, back) });
    await expect(link).toHaveAttribute("href", parent);
    const arrow = link.querySelector("svg")!.getBoundingClientRect();
    const text = context.canvas.getByText(storyText(context, back)).getBoundingClientRect();
    await expect(storyLocale(context) === "ar" ? arrow.left >= text.right - 1 : arrow.right <= text.left + 1).toBe(true);
    await expectTabFocusRing(link);
    await userEvent.click(link);
    await expect(context.args.goBack).not.toHaveBeenCalled();
  },
};

/** The page before, in this tab, was inside Rabaed: a click goes back in history, as the browser's Back does. */
export const InsideRabaed: Story = {
  args: { previousEntry: () => `${window.location.origin}/en/projects/p1/work-items?stage=open` },
  play: async (context) => {
    await userEvent.click(context.canvas.getByRole("link", { name: storyText(context, back) }));
    await expect(context.args.goBack).toHaveBeenCalledOnce();
  },
};

/** In a full-screen tool's bar (the Workflow builder): the arrow alone, named "Back" and with it as its tooltip. Same rule. */
export const IconOnly: Story = {
  args: { iconOnly: true, previousEntry: () => `${window.location.origin}/en/library` },
  play: async (context) => {
    const link = context.canvas.getByRole("link", { name: storyText(context, back) });
    await expect(link).toHaveAttribute("title", storyText(context, back));
    await expect(context.canvas.queryByText(storyText(context, back))).toBeNull();
    await userEvent.click(link);
    await expect(context.args.goBack).toHaveBeenCalledOnce();
  },
};

/** On a phone the link is at least 44px tall, so a gloved hand can hit it. */
export const Phone: Story = {
  parameters: phone,
  play: async (context) => {
    await expectTouchTarget(context.canvas.getByRole("link", { name: storyText(context, back) }));
  },
};
