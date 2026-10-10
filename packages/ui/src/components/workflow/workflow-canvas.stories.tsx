import { stepAgeLabel } from "@rabaed/domain";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { AgeDots } from "../status/age-dots.tsx";
import { storyLocale } from "../../storybook/locale.ts";
import { consultantCompany, twoTierReview, workflowLabels, workflowStages } from "../../storybook/workflow.ts";
import { WorkflowCanvas } from "./workflow-canvas.tsx";

const meta = {
  title: "Workflow/WorkflowCanvas",
  component: WorkflowCanvas,
  args: { definition: twoTierReview, stages: workflowStages, locale: "en", labels: workflowLabels("en") },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

const frame = "h-[600px] p-4";

/** The whole Workflow, as its authors read it (Settings → Workflows): every Participant's Steps. */
export const WholeWorkflow: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className={frame}>
        <WorkflowCanvas {...args} locale={locale} labels={workflowLabels(locale)} />
      </div>
    );
  },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    await expect(await canvas.findByText(twoTierReview.steps[3]!.name[locale])).toBeVisible();
    await expect(canvas.getByText(workflowLabels(locale).outcome)).toBeVisible();
  },
};

/** An item's map, for the Contractor while its own PM holds the item: its Step is marked. */
export const ItemAtOwnStep: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className={frame}>
        <WorkflowCanvas {...args} locale={locale} labels={workflowLabels(locale)} viewerRole="contractor" position={{ kind: "own", stepKey: "contractor_pm" }} />
      </div>
    );
  },
  play: async ({ canvasElement, canvas, context }) => {
    await canvas.findByText(twoTierReview.steps[1]!.name[storyLocale(context)]);
    await expect(canvasElement.querySelectorAll("[data-current]")).toHaveLength(1);
  },
};

/**
 * An item's map, for the Contractor while the Consultant holds it (V14,
 * scenario RP-438-1): the Consultant's part is one card, "With Design
 * Consultants LLC", and none of its Steps is named or marked.
 */
export const ItemWithAnotherCompany: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className={frame}>
        <WorkflowCanvas
          {...args}
          locale={locale}
          labels={workflowLabels(locale)}
          viewerRole="contractor"
          position={{ kind: "company", role: "consultant", companyName: consultantCompany }}
          currentDetail={
            <span className="inline-flex items-center gap-1.5">
              <AgeDots weeks={2} locale={locale} />
              <span aria-hidden="true">{stepAgeLabel(2, locale)}</span>
            </span>
          }
        />
      </div>
    );
  },
  play: async ({ canvasElement, canvas, context }) => {
    const locale = storyLocale(context);
    await expect(await canvas.findByText(workflowLabels(locale).withCompany(consultantCompany[locale]))).toBeVisible();
    for (const hidden of [twoTierReview.steps[2]!, twoTierReview.steps[3]!]) {
      await expect(canvasElement.outerHTML).not.toContain(hidden.name.en);
      await expect(canvasElement.outerHTML).not.toContain(hidden.name.ar);
    }
  },
};

/** A closed item's map: the outcome it reached is marked. */
export const ClosedItem: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className={frame}>
        <WorkflowCanvas {...args} locale={locale} labels={workflowLabels(locale)} viewerRole="contractor" position={{ kind: "closed", stepKey: "revise" }} />
      </div>
    );
  },
  play: async ({ canvasElement, canvas, context }) => {
    await canvas.findByText(twoTierReview.steps[5]!.name[storyLocale(context)]);
    await expect(canvasElement.querySelectorAll("[data-current]")).toHaveLength(1);
  },
};

/** Editable (the builder, WF-16): Steps can be dragged; the layout comes back in left-to-right units. */
export const Editable: Story = {
  render: (args, context) => {
    const locale = storyLocale(context);
    return (
      <div className={frame}>
        <WorkflowCanvas {...args} locale={locale} labels={workflowLabels(locale)} mode="edit" />
      </div>
    );
  },
  play: async ({ canvas, context }) => {
    await expect(await canvas.findByText(twoTierReview.steps[0]!.name[storyLocale(context)])).toBeVisible();
  },
};
