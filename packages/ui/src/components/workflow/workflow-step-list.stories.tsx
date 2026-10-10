import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import { consultantCompany, twoTierReview, workflowLabels, workflowStages } from "../../storybook/workflow.ts";
import { WorkflowStepList } from "./workflow-step-list.tsx";

const meta = {
  title: "Workflow/WorkflowStepList",
  component: WorkflowStepList,
  args: { definition: twoTierReview, stages: workflowStages, locale: "en", labels: workflowLabels("en") },
} satisfies Meta<typeof WorkflowStepList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole Workflow as a list: each Stage's Steps in order, with the Transitions leaving them. */
export const WholeWorkflow: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return <WorkflowStepList {...args} locale={locale} labels={workflowLabels(locale)} className="max-w-xl" />;
  },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    await expect(canvas.getByRole("list", { name: workflowLabels(locale).list })).toBeVisible();
    await expect(canvas.getByText(twoTierReview.steps[3]!.name[locale])).toBeVisible();
  },
};

/** An item's map as a list, while the Consultant holds it: one entry "With Design Consultants LLC", marked current (V14). */
export const ItemWithAnotherCompany: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <WorkflowStepList
        {...args}
        locale={locale}
        labels={workflowLabels(locale)}
        viewerRole="contractor"
        position={{ kind: "company", role: "consultant", companyName: consultantCompany }}
        className="max-w-xl"
      />
    );
  },
  play: async ({ canvasElement, canvas, context }) => {
    const locale = storyLocale(context);
    const current = canvasElement.querySelector("[aria-current=step]");
    await expect(current?.textContent).toContain(workflowLabels(locale).withCompany(consultantCompany[locale]));
    await expect(canvas.queryByText(twoTierReview.steps[3]!.name[locale])).toBeNull();
  },
};
