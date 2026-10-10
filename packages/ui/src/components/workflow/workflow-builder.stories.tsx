import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import {
  builderDraft,
  builderOutcomes,
  builderPositions,
  builderProblems,
  twoTierReview,
  workflowBuilderLabels,
  workflowStages,
} from "../../storybook/workflow.ts";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./workflow-builder.tsx";

const saved = { kind: "saved" as const, at: new Date("2026-10-10T11:32:00Z") };

const meta = {
  title: "Workflow/WorkflowBuilder",
  component: WorkflowBuilder,
  args: {
    name: "Material Submittal – 2-tier review",
    versionNo: 4,
    published: { versionNo: 3, definition: twoTierReview },
    definition: builderDraft,
    stages: workflowStages,
    outcomes: builderOutcomes,
    positions: builderPositions,
    locale: "en",
    labels: workflowBuilderLabels("en"),
    problems: builderProblems,
    saveState: saved,
    backHref: "#workflows",
    onChange: fn(),
    onValidate: fn(async () => builderProblems),
    onPublish: fn(async () => ({ ok: true as const, versionNo: 4 })),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The builder at 1024 wide and a desktop's height, in the story's language. */
function Frame(props: WorkflowBuilderProps & { locale: WorkflowBuilderProps["locale"] }) {
  return (
    <div className="h-[900px] bg-canvas">
      <WorkflowBuilder {...props} />
    </div>
  );
}

const render: Story["render"] = (args, context) => {
  const locale = storyLocale(context);
  return <Frame {...args} locale={locale} labels={workflowBuilderLabels(locale)} />;
};

/** React Flow shows a node once it has measured it. */
const shown = async (canvas: ReturnType<typeof within>, text: string) => waitFor(async () => expect(await canvas.findByText(text)).toBeVisible());

/** The draft open, nothing selected: the palette, the canvas, what the draft holds and its problems. */
export const Draft: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await expect(canvas.getByRole("heading", { level: 1, name: "Material Submittal – 2-tier review" })).toBeVisible();
    await expect(canvas.getByText(labels.draft("4"), { exact: false })).toBeVisible();
    await expect(canvas.getByText(labels.nothingSelected)).toBeVisible();
    await expect(canvas.getByText(labels.errors("1"))).toBeVisible();
    await expect(canvas.getByRole("button", { name: labels.undo })).toBeDisabled();
  },
};

/** Clicking a validation problem selects the Step it concerns, and the side editor shows it. */
export const StepSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.showProblem(builderProblems[0]!.message[locale]) }));
    const editor = within(canvas.getByRole("complementary", { name: labels.editor }));
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("Owner Representative approval");
    await expect(editor.getByLabelText(labels.nameAr)).toHaveValue("اعتماد ممثل المالك");
    await expect(editor.getByText(labels.whoHolds)).toBeVisible();
  },
};

/** A Transition selected (from its problem): label, kind, outcome and the Screen it asks, read-only. */
export const TransitionSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.showProblem(builderProblems[1]!.message[locale]) }));
    const editor = within(canvas.getByRole("complementary", { name: labels.editor }));
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Send to Owner Rep");
    await expect(editor.getByRole("radio", { name: labels.map.kind("submit") })).toBeChecked();
    await expect(editor.getByText(labels.internalNoteOnly)).toBeVisible();
  },
};

/** Adding a Step from the palette (by keyboard too): it is selected, and the edit reaches `onChange` and can be undone. */
export const AddStep: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    const palette = within(canvas.getByRole("complementary", { name: labels.palette }));
    palette.getByRole("button", { name: labels.step }).focus();
    await userEvent.keyboard("{Enter}");
    const editor = within(canvas.getByRole("complementary", { name: labels.editor }));
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("New step");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ key: "new_step" })]) }));
    await shown(canvas, labels.names.newStep[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.undo }));
    await waitFor(() => expect(canvas.queryByText(labels.names.newStep[locale])).toBeNull());
  },
};

/** A test run: from the Draft Step, Transitions taken in turn; the path stays lit. */
export const TestRun: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.testRun }));
    const bar = within(canvas.getByRole("region", { name: labels.testRun }));
    await userEvent.click(bar.getByRole("button", { name: builderDraft.transitions[0]!.label[locale] }));
    await expect(bar.getByText(builderDraft.steps[1]!.name[locale])).toBeVisible();
  },
};

/** Publishing: what changed since v3, the server's check passed, and that running items keep their Version. */
export const Publish: Story = {
  render,
  args: { onValidate: fn(async () => []) },
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await expect(dialog.getByText(labels.changesSince("3"))).toBeVisible();
    await expect(await dialog.findByText(labels.passed)).toBeVisible();
    await expect(dialog.getByText(labels.appliesToNew("4"))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeEnabled();
  },
};

/** Publishing refused: the server's check finds an error, and Publish stays off. */
export const PublishBlocked: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await expect(await dialog.findByText(labels.errorsBlock("1"))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeDisabled();
  },
};

/** A save that failed, as the bar says it, on a draft with no problems. */
export const SaveStates: Story = {
  args: { saveState: { kind: "failed" }, problems: [] },
  render,
  play: async ({ canvas, context }) => {
    const labels = workflowBuilderLabels(storyLocale(context));
    await expect(canvas.getByText(labels.saveFailed, { exact: false })).toBeVisible();
    await expect(canvas.getByText(labels.noErrors)).toBeVisible();
  },
};
