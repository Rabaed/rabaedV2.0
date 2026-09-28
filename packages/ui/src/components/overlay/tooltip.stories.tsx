import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { storyText } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { IconButton } from "../button/button.tsx";
import { Icon } from "../icon/icon.tsx";
import { Tooltip } from "./tooltip.tsx";

const copy = {
  label: { en: "Filter", ar: "تصفية" },
  tip: { en: "Filter by Trade and Location", ar: "التصفية حسب التخصص والموقع" },
};

const meta = {
  title: "Overlays/Tooltip",
  render: (_args, context) => (
    <div className="p-10">
      <Tooltip content={storyText(context, copy.tip)}>
        <IconButton label={storyText(context, copy.label)} variant="secondary">
          <Icon name="filter" />
        </IconButton>
      </Tooltip>
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

const trigger = (context: PlayContext) => context.canvas.getByRole("button", { name: storyText(context, copy.label) });

/** Keyboard focus shows it at once, and the trigger is described by it. Left open for the screenshot. */
export const OnFocus: Story = {
  parameters: overlay,
  play: async (context) => {
    await userEvent.tab();
    await expect(trigger(context)).toHaveFocus();
    await expect(await screen.findByRole("tooltip")).toHaveTextContent(storyText(context, copy.tip));
    await expect(trigger(context)).toHaveAccessibleDescription(storyText(context, copy.tip));
  },
};

/** Hover shows it; Escape hides it without moving focus. */
export const HoverAndEscape: Story = {
  play: async (context) => {
    await userEvent.hover(trigger(context));
    await screen.findByRole("tooltip");
    trigger(context).focus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    await expect(trigger(context)).toHaveFocus();
  },
};
