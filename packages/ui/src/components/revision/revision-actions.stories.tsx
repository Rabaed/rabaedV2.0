import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { expectTouchTarget, phone } from "../../storybook/form.ts";
import { storyLocale } from "../../storybook/locale.ts";
import { overlay } from "../../storybook/overlay.ts";
import { revisionActionsLabels } from "../../storybook/revision.ts";
import { RevisionActions, type RevisionCall } from "./revision-actions.tsx";

// Create Revision and Discard Revision on the item page (RP-316, spec RP-311):
// each only when the API offers it. Story data only.

const labelsOf = (context: { globals: Record<string, unknown> }) => revisionActionsLabels[storyLocale(context)];

const ok: RevisionCall = async () => ({ ok: true });

const meta = {
  title: "Work Items/RevisionActions",
  component: RevisionActions,
  args: { labels: revisionActionsLabels.en, canCreate: false, canDiscard: false, onCreate: fn<RevisionCall>(ok), onDiscard: fn<RevisionCall>(ok) },
  render: (args, context) => <RevisionActions {...args} labels={labelsOf(context)} />,
  decorators: [(Story) => <div className="max-w-3xl">{Story()}</div>],
} satisfies Meta<typeof RevisionActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a closed Code C item, for a Member the Draft Step allows: Create Revision, which the page then opens. */
export const CreateRevision: Story = {
  args: { canCreate: true },
  play: async (context) => {
    const { canvas, args } = context;
    const section = canvas.getByRole("region", { name: labelsOf(context).section });
    await userEvent.click(within(section).getByRole("button", { name: labelsOf(context).create }));
    await expect(args.onCreate).toHaveBeenCalledOnce();
    await expect(canvas.queryByRole("button", { name: labelsOf(context).discard })).toBeNull();
  },
};

/** Refused (a Revision opened meanwhile, say): one plain answer, nothing about why. */
export const CreateRefused: Story = {
  args: { canCreate: true, onCreate: fn(async () => ({ ok: false as const, reason: "revision_not_allowed" })) },
  play: async (context) => {
    const { canvas } = context;
    await userEvent.click(canvas.getByRole("button", { name: labelsOf(context).create }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(labelsOf(context).refusals.revision_not_allowed);
  },
};

/** On a Draft Revision: Discard Revision asks first, then discards. Left open for the screenshot. */
export const DiscardRevision: Story = {
  parameters: overlay,
  args: { canDiscard: true },
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("button", { name: labelsOf(context).discard }));
    const dialog = await screen.findByRole("dialog", { name: labelsOf(context).discardTitle });
    await expect(args.onDiscard).not.toHaveBeenCalled();
    await expect(within(dialog).getByRole("button", { name: labelsOf(context).cancel })).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: labelsOf(context).discard })).toBeVisible();
  },
};

/** Confirming discards it and closes the question. */
export const DiscardConfirmed: Story = {
  args: { canDiscard: true },
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("button", { name: labelsOf(context).discard }));
    const dialog = await screen.findByRole("dialog", { name: labelsOf(context).discardTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: labelsOf(context).discard }));
    await expect(args.onDiscard).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/** A Revision that left Draft meanwhile: the question says so and stays open. */
export const DiscardRefused: Story = {
  args: { canDiscard: true, onDiscard: fn(async () => ({ ok: false as const, reason: "not_discardable" })) },
  play: async (context) => {
    const { canvas } = context;
    await userEvent.click(canvas.getByRole("button", { name: labelsOf(context).discard }));
    const dialog = await screen.findByRole("dialog", { name: labelsOf(context).discardTitle });
    await userEvent.click(within(dialog).getByRole("button", { name: labelsOf(context).discard }));
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(labelsOf(context).refusals.not_discardable);
  },
};

/** Nothing offered (another Company, or a Member the Draft Step doesn't allow): nothing shown. */
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
