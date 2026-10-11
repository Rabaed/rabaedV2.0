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
    const added = builderDraft.steps[4]!.name[locale];
    // The change line reads "Added <name>", the name in its own <bdi>.
    await expect(dialog.getByText((_, el) => el?.tagName === "LI" && el.textContent?.trim() === `${labels.added} ${added}`)).toBeVisible();
    // On v4's map only (React Flow shows a node once it has measured it), marked added.
    const onMap = () => dialog.queryAllByText(added).find((el) => el.closest("li") === null);
    await waitFor(() => expect(onMap()).toBeVisible());
    await expect(onMap()!.closest("[class*='ring-success']")).not.toBeNull();
  },
};
