import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { replacementActionsLabels } from "../../storybook/revision.ts";
import { ReplacementActions, type ReplacementCall } from "./replacement-actions.tsx";

// Create replacement on the item page (RP-435, spec RP-423): only when the API
// offers it, on an item closed with an outcome that offers a replacement. Story
// data only.

const labelsOf = (context: { globals: Record<string, unknown> }) => replacementActionsLabels[storyLocale(context)];

const ok: ReplacementCall = async () => ({ ok: true });

const meta = {
  title: "Work Items/ReplacementActions",
  component: ReplacementActions,
  args: { labels: replacementActionsLabels.en, canCreate: false, onCreate: fn<ReplacementCall>(ok) },
  render: (args, context) => <ReplacementActions {...args} labels={labelsOf(context)} />,
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof ReplacementActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a closed Code D item, for a Member the Draft Step allows: Create replacement, which the page then opens. */
export const CreateReplacement: Story = {
  args: { canCreate: true },
  play: async (context) => {
    const { canvas, args } = context;
    const section = canvas.getByRole("region", { name: labelsOf(context).section });
    await userEvent.click(within(section).getByRole("button", { name: labelsOf(context).create }));
    await expect(args.onCreate).toHaveBeenCalledOnce();
  },
};

/** Refused (a replacement opened meanwhile, say): one plain answer, nothing about why. */
export const CreateRefused: Story = {
  args: { canCreate: true, onCreate: fn(async () => ({ ok: false as const, reason: "replacement_not_allowed" })) },
  play: async (context) => {
    const { canvas } = context;
    await userEvent.click(canvas.getByRole("button", { name: labelsOf(context).create }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(labelsOf(context).refusals.replacement_not_allowed);
  },
};

/** Nothing offered (another Company, a Member the Draft Step doesn't allow, or an outcome with no replacement): nothing shown. */
export const NothingOffered: Story = {
  play: async (context) => {
    await expect(context.canvas.queryByRole("region", { name: labelsOf(context).section })).toBeNull();
    await expect(context.canvas.queryAllByRole("button")).toHaveLength(0);
  },
};

/** At phone width: the button is touch-sized. */
export const Phone: Story = {
  parameters: phone,
  args: { canCreate: true },
  play: async (context) => {
    await expectTouchTarget(context.canvas.getByRole("button", { name: labelsOf(context).create }));
  },
};
