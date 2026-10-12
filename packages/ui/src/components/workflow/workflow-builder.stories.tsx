import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import {
  builderDraft,
  builderForm,
  builderOutcomes,
  builderPositions,
  builderProblems,
  builderRunning,
  builderScreens,
  twoTierReview,
  workflowBuilderLabels,
  workflowStages,
} from "../../storybook/workflow.ts";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./workflow-builder.tsx";

// The builder in the states of the owner's reference (RP-555, `Rabaed Settings Workflows`):
// each story's comment names the reference state it pairs with (builder-ref/NN-…).

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
    form: builderForm,
    screens: builderScreens,
    running: builderRunning,
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

/** The builder at the viewport's size (at least a laptop's height), in the story's language. */
function Frame(props: WorkflowBuilderProps & { locale: WorkflowBuilderProps["locale"] }) {
  return (
    <div className="h-dvh max-h-[1080px] min-h-[700px] bg-canvas">
      <WorkflowBuilder {...props} />
    </div>
  );
}

const render: Story["render"] = (args, context) => {
  const locale = storyLocale(context);
  return <Frame {...args} locale={locale} labels={workflowBuilderLabels(locale)} />;
};

type Canvas = ReturnType<typeof within>;
/** React Flow shows a node once it has measured it. */
const shown = async (canvas: Canvas, text: string) => waitFor(async () => expect(await canvas.findByText(text)).toBeVisible());
const step = (key: string) => builderDraft.steps.find((s) => s.key === key)!;
const transition = (key: string) => builderDraft.transitions.find((t) => t.key === key)!;
const editorOf = (canvas: Canvas, labels: ReturnType<typeof workflowBuilderLabels>) => within(canvas.getByRole("complementary", { name: labels.editor }));
/** Clicks a Transition's label on the canvas: it selects the Transition. */
const pickTransition = async (canvas: Canvas, key: string, locale: "en" | "ar") => {
  const label = transition(key).label[locale];
  await shown(canvas, label);
  await userEvent.click(canvas.getAllByText(label)[0]!);
};
/** Clicks a Step's card on the canvas: it selects the Step. */
const pickStep = async (canvas: Canvas, key: string, locale: "en" | "ar") => {
  const name = step(key).name[locale];
  await shown(canvas, name);
  await userEvent.click(canvas.getAllByText(name)[0]!);
};

/** Ref 20: the draft open, nothing selected: the palette, the canvas, what the draft holds and its problems. */
export const Draft: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await expect(canvas.getByRole("heading", { level: 1, name: "Material Submittal – 2-tier review" })).toBeVisible();
    await expect(canvas.getByText(labels.draft("4"), { exact: false })).toBeVisible();
    await expect(canvas.getByText(labels.nothingSelected)).toBeVisible();
    // One error and one warning, in the singular.
    await expect(canvas.getByText(labels.errors(1, "1"))).toBeVisible();
    await expect(canvas.getByText(labels.warnings(1, "1"), { exact: false })).toBeVisible();
    await expect(canvas.getByRole("button", { name: labels.undo })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: labels.autoLayout })).toBeVisible();
    // The overview carries no attribution.
    await expect(canvas.queryByText("React Flow")).toBeNull();
  },
};

/** Ref 21: a Step selected (from its problem): who holds it, and a pool hint that names no one. */
export const StepSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.showProblem(builderProblems[0]!.message[locale]) }));
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("Owner Representative approval");
    await expect(editor.getByLabelText(labels.nameAr)).toHaveValue("اعتماد ممثل المالك");
    await expect(editor.getByText(labels.whoHolds)).toBeVisible();
    await expect(editor.getByText(labels.poolHint(`${labels.map.role("owner_representative")} · ${labels.map.permission("approve")}`))).toBeVisible();
    // Not the raiser's: no Form editing to offer (ADR 0019).
    await expect(editor.queryByText(labels.editsForm)).toBeNull();
  },
};

/** Ref 22: the raiser's internal Step: its one Form setting (ADR 0019), which the reference shows as sections. */
export const StepContractor: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "contractor_pm", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("Contractor PM review");
    await expect(editor.getByRole("switch", { name: labels.editsForm })).toBeVisible();
  },
};

/** Ref 23: a Send selected: its label, Type, the Screen picker with its preview, and the Notifications inline. */
export const TransitionSend: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "send_for_review", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Send for Review");
    await expect(editor.getByRole("radio", { name: labels.map.kind("send") })).toBeChecked();
    await expect(editor.getByRole("combobox", { name: labels.screen })).toBeVisible();
    await expect(editor.getByText(labels.internalNoteOnly)).toBeVisible();
    await expect(editor.getByRole("group", { name: labels.rules.recipients })).toBeVisible();
  },
};

/** Ref 24: the conditional Transition (cost impact over 500,000): its rules, and the filter badge on the Step it enters. */
export const TransitionCondition: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[4]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.showProblem(builderProblems[1]!.message[locale]) }));
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Send to Owner Rep");
    await expect(editor.getByRole("radio", { name: labels.map.kind("submit") })).toBeChecked();
    // Only a Close sets an outcome: on a Submit it is off, and says why.
    await expect(editor.getByRole("combobox", { name: labels.outcomeCode })).toBeDisabled();
    await expect(editor.getByText(labels.outcomeOnlyOnClose)).toBeVisible();
    await expect(canvas.getAllByRole("img", { name: labels.map.conditional! }).length).toBeGreaterThan(0);
  },
};

/** Ref 26: a Close with a Review Code: the preview card shows the codes, the chosen one solid. */
export const TransitionCode: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "approve_a", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByRole("radio", { name: labels.map.kind("close") })).toBeChecked();
    await expect(editor.getByRole("combobox", { name: labels.outcomeCode })).toBeEnabled();
    await expect(editor.getByRole("combobox", { name: labels.screen })).toHaveTextContent(labels.screenOwn);
  },
};

/** Ref 27: a Return asking the Screen "Return with a reason": the picker shows it, the preview asks its field. */
export const TransitionReturn: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "return_to_engineer", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByRole("radio", { name: labels.map.kind("return") })).toBeChecked();
    await expect(editor.getByRole("combobox", { name: labels.screen })).toHaveTextContent(builderScreens[1]!.name[locale]);
  },
};

/** Ref 28: an End selected: its names and Delete. */
export const EndSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "rejected", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByText(labels.endHeading)).toBeVisible();
    await expect(editor.getByRole("button", { name: labels.deleteStep })).toBeVisible();
  },
};

/** Ref 32: Validate: the toast counts the errors to fix. */
export const ValidateToast: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.validate }));
    await expect(await within(document.body).findByText(labels.errorsToFix(1, "1"))).toBeVisible();
  },
};

/** Ref 33: adding a Step from the palette (by keyboard too): it is selected, and the edit reaches `onChange` and can be undone. */
export const AddStep: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    const palette = within(canvas.getByRole("complementary", { name: labels.palette }));
    palette.getByRole("button", { name: labels.step }).focus();
    await userEvent.keyboard("{Enter}");
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("New step");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ key: "new_step" })]) }));
    await shown(canvas, labels.names.newStep[locale]);
  },
};

/** Ref 34: a ready-made pair of Steps added from the palette. */
export const AddReadyMade: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    const palette = within(canvas.getByRole("complementary", { name: labels.palette }));
    await userEvent.click(palette.getByRole("button", { name: labels.templateInternal }));
    await shown(canvas, labels.names.engineerReview[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.undo }));
    await waitFor(() => expect(canvas.queryByText(labels.names.engineerReview[locale])).toBeNull());
  },
};

/** The sampled field's name (the Form's cost impact), as the bar labels its input. */
const costLabel = { en: "Cost impact (SAR)", ar: "أثر التكلفة (ريال)" };

/** Takes the test run from the Draft Step to the Consultant Manager's decision. */
const toManager = async (canvas: Canvas, locale: "en" | "ar") => {
  const labels = workflowBuilderLabels(locale);
  await shown(canvas, builderDraft.steps[0]!.name[locale]);
  await userEvent.click(canvas.getByRole("button", { name: labels.testRun }));
  const bar = within(canvas.getByRole("region", { name: labels.testRun }));
  for (const key of ["send_for_review", "submit", "send_to_manager"]) await userEvent.click(bar.getByRole("button", { name: transition(key).label[locale] }));
  return bar;
};

/** Refs 36-37: a test run: from the Draft Step, Transitions taken in turn; the path stays lit. */
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

/** Ref 38: the sample's cost impact is over 500,000, so the conditional "Send to Owner Rep" is offered. */
export const TestRunCondition: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const bar = await toManager(canvas, locale);
    await expect(bar.getByRole("textbox", { name: costLabel[locale] })).toHaveValue("500001");
    await expect(bar.getByRole("button", { name: transition("send_to_owner").label[locale] })).toBeVisible();
  },
};

/** Ref 39: a low cost impact: the conditional Transition isn't offered. */
export const TestRunLowCost: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const bar = await toManager(canvas, locale);
    const cost = bar.getByRole("textbox", { name: costLabel[locale] });
    await userEvent.clear(cost);
    await userEvent.type(cost, "120000");
    await waitFor(() => expect(bar.queryByRole("button", { name: transition("send_to_owner").label[locale] })).toBeNull());
    await expect(bar.getByRole("button", { name: transition("approve_a").label[locale] })).toBeVisible();
  },
};

/** Ref 40: the run reaches an outcome: "Finished: Approved". */
export const TestRunFinished: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    const bar = await toManager(canvas, locale);
    await userEvent.click(bar.getByRole("button", { name: transition("approve_a").label[locale] }));
    await expect(bar.getByText(labels.finished(step("approved").name[locale]))).toBeVisible();
  },
};

/** Ref 41: publishing refused: the server's check finds an error, and Publish stays off. */
export const PublishBlocked: Story = {
  render,
  parameters: {
    overlay: true,
    // In Arabic, the change line "تغيّر اعتماد – Code A" renders 206 pixels differently from run to run on CI
    // (PR #180 was dropped from the merge queue on it twice); a mixed-script line, not a layout change.
    screenshot: { allowedMismatchedPixels: 300, reason: "Mixed Arabic/Latin change line varies by about 206 pixels between CI runs" },
  },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await expect(await dialog.findByText(labels.errorsBlock(1, "1"))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeDisabled();
  },
};

/** Ref 43: publishing: what changed since v3, the check passed, the change note, and how many items keep their Version. */
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
    await expect(dialog.getByRole("textbox", { name: labels.changeNote })).toBeVisible();
    await expect(dialog.getByText(labels.keepVersions({ latest: 31, latestN: "31", older: 16, olderN: "16", version: "3", next: "4" }))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeEnabled();
  },
};

/** Ref 44: Publish without a change note is refused in the dialog; with one, it publishes with it. */
export const PublishNoteRequired: Story = {
  render,
  args: { onValidate: fn(async () => []) },
  parameters: { overlay: true },
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, builderDraft.steps[0]!.name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await dialog.findByText(labels.passed);
    await userEvent.click(dialog.getByRole("button", { name: labels.publishVersion("4") }));
    await expect(dialog.getByText(labels.changeNoteRequired)).toBeVisible();
    await expect(args.onPublish).not.toHaveBeenCalled();
  },
};

/** Ref 46: a blank Workflow starts with one Draft Step, selected, and the page saves it. */
export const BlankWorkflow: Story = {
  args: { definition: { steps: [], transitions: [], layout: {} }, published: null, problems: [], running: [] },
  render,
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, labels.names.firstStep![locale]);
    await expect(editorOf(canvas, labels).getByLabelText(labels.nameEn)).toHaveValue("Contractor Engineer");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({ key: "contractor_engineer", stage: "draft" })] }));
  },
};

/** Just opened, nothing saved yet: the bar names no save time. */
export const JustOpened: Story = {
  args: { saveState: { kind: "opened" } },
  render,
  play: async ({ canvas, context }) => {
    const labels = workflowBuilderLabels(storyLocale(context));
    await expect(canvas.getByText(labels.draft("4"), { exact: false })).toBeVisible();
    await expect(canvas.queryByText(labels.saved(""), { exact: false })).toBeNull();
    await expect(canvas.queryByText(labels.unsaved, { exact: false })).toBeNull();
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
