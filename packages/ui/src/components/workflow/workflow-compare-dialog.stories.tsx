import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { builderDraft, twoTierReview, workflowCompareLabels, workflowStages } from "../../storybook/workflow.ts";
import { WorkflowCompareDialog } from "./workflow-changes.tsx";

const meta = {
  title: "Workflow/WorkflowCompareDialog",
  component: WorkflowCompareDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    before: { versionNo: 3, definition: twoTierReview },
    after: { versionNo: 4, definition: builderDraft },
    stages: workflowStages,
    locale: "en",
    labels: workflowCompareLabels("en"),
  },
  parameters: { overlay: true },
} satisfies Meta<typeof WorkflowCompareDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** v3 beside v4: the Owner Representative approval and its Transitions added, the Code A reply changed. */
export const Compare: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return <WorkflowCompareDialog {...args} locale={locale} labels={workflowCompareLabels(locale)} />;
  },
  play: async ({ context }) => {
    const locale = storyLocale(context);
    const labels = workflowCompareLabels(locale);
    const dialog = within(await within(document.body).findByRole("dialog", { name: labels.title("3", "4") }));
    await expect(dialog.getByText(`${labels.added} ${builderDraft.steps[4]!.name[locale]}`)).toBeVisible();
    // On v4's map only (React Flow shows a node once it has measured it), marked added.
    await waitFor(async () => expect(await dialog.findByText(builderDraft.steps[4]!.name[locale])).toBeVisible());
    await expect(dialog.getByText(builderDraft.steps[4]!.name[locale]).closest("[class*='ring-success']")).not.toBeNull();
  },
};
