import type { Meta, StoryObj } from "@storybook/react-vite";
import { useCallback, useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { WorkflowDefinition, WorkflowProblem } from "@rabaed/domain";
import { actionFormLabels } from "../../storybook/form-engine.ts";
import { storyLocale } from "../../storybook/locale.ts";
import {
  builderDraft,
  builderDraftSampled,
  builderForm,
  builderOutcomes,
  builderPositions,
  builderProblemsOf,
  builderPublished,
  builderRunning,
  builderScreens,
  workflowBuilderLabels,
  workflowStages,
} from "../../storybook/workflow.ts";
import { WorkflowBuilder, type WorkflowBuilderProps, type WorkflowSaveState } from "./workflow-builder.tsx";

// The builder in the states of the owner's V2 reference (RP-555, `Rabaed Workflow Builder V2`):
// each story's comment names the V2 state it pairs with (v2/ref/NN-…). The draft is V2's own
// (6 Steps, 15 Transitions); its problems are the publish checks' own, run on every edit.

const saved = { kind: "saved" as const, at: new Date("2026-10-10T11:32:00Z") };
const workflowName = { en: "Material Submittal – 2-tier review", ar: "اعتماد المواد – مراجعة على مستويين" };

/**
 * The V2 draft with its errors fixed, as V2's "errors fixed" state: ready to publish. Its Return
 * stays in Internal Review, as publishing asks since RP-437 (ADR 0020, `return_to_draft`): it goes
 * to a Contractor Engineer Step there, which sends it for review again (as the MAR's Version 3).
 */
const fixedDraft: WorkflowDefinition = {
  ...builderDraftSampled,
  steps: [
    ...builderDraftSampled.steps.filter((s) => s.key !== "consultant_qa").map((s) => (s.key === "owner_rep" ? { ...s, outcomeMode: "issue_outcome" as const } : s)),
    { key: "contractor_engineer", name: { en: "Contractor Engineer", ar: "مهندس المقاول" }, stage: "internal_review", actor: { role: "contractor", permission: "create" }, outcomeMode: "none" },
  ],
  transitions: [
    ...builderDraftSampled.transitions
      .filter((t) => !["send_to_qa", "return_to_consultant", "owner_return"].includes(t.key))
      .map((t) => (t.key === "return" ? { ...t, to: "contractor_engineer" } : t)),
    {
      key: "send_for_review_again",
      label: { en: "Send for Review", ar: "إرسال للمراجعة" },
      kind: "send",
      from: "contractor_engineer",
      to: "contractor_pm",
      outcome: null,
      permission: "review",
      actionForm: null,
    },
  ],
  layout: { ...builderDraftSampled.layout, contractor_engineer: { x: 280, y: 420 } },
};

const meta = {
  title: "Workflow/WorkflowBuilder",
  component: WorkflowBuilder,
  args: {
    name: "Material Submittal – 2-tier review",
    versionNo: 4,
    published: { versionNo: 3, definition: builderPublished },
    definition: builderDraft,
    stages: workflowStages,
    outcomes: builderOutcomes,
    positions: builderPositions,
    form: builderForm,
    typeCode: "MAR",
    screens: builderScreens,
    running: builderRunning,
    locale: "en",
    labels: workflowBuilderLabels("en"),
    problems: builderProblemsOf(builderDraft),
    saveState: saved,
    backHref: "#workflows",
    versionsHref: (n: number) => `#versions/${n}`,
    screensHref: "#screens",
    onChange: fn(),
    onValidate: fn(async () => [] as readonly WorkflowProblem[]),
    onPublish: fn(async () => ({ ok: true as const, versionNo: 4 })),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The builder at the viewport's size (at least a laptop's height), in the story's language, as a
 * page drives it: each edit is "saved" and checked again with the publish checks, and Validate
 * and Publish see the problems of the draft as it stands.
 */
function Frame(props: WorkflowBuilderProps) {
  // Each story starts from the default view (curved arrows, snap and minimap on), whatever an earlier story chose.
  useState(() => {
    try {
      localStorage.removeItem("rabaed.workflowBuilder.view");
    } catch {
      // No storage: the defaults anyway.
    }
  });
  const latest = useRef(props.definition);
  const [problems, setProblems] = useState(() => builderProblemsOf(props.definition));
  const [saveState, setSaveState] = useState<WorkflowSaveState>(props.saveState);
  const { onChange, onValidate, onPublish } = props;
  const change = useCallback(
    (definition: WorkflowDefinition) => {
      latest.current = definition;
      onChange(definition);
      setProblems(builderProblemsOf(definition));
      setSaveState({ kind: "unsaved" });
    },
    [onChange],
  );
  const validate = useCallback(async () => {
    await onValidate();
    const found = builderProblemsOf(latest.current);
    setProblems(found);
    return found;
  }, [onValidate]);
  const publish = useCallback(
    async (note: string) => {
      const found = builderProblemsOf(latest.current);
      if (found.some((p) => p.severity === "error")) return { ok: false as const, problems: found };
      return onPublish(note);
    },
    [onPublish],
  );
  return (
    <div className="h-dvh max-h-[1080px] min-h-[700px] bg-canvas">
      <WorkflowBuilder {...props} problems={problems} saveState={saveState} onChange={change} onValidate={validate} onPublish={publish} />
    </div>
  );
}

const render: Story["render"] = (args, context) => {
  const locale = storyLocale(context);
  // The Workflow's name in the story's language, as a page passes it.
  return <Frame {...args} name={workflowName[locale]} locale={locale} labels={workflowBuilderLabels(locale)} actionFormLabels={actionFormLabels[locale]} />;
};

type Canvas = ReturnType<typeof within>;
/** React Flow shows a node once it has measured it. */
const shown = async (canvas: Canvas, text: string) => waitFor(async () => expect((await canvas.findAllByText(text))[0]).toBeVisible());
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
const ready = (canvas: Canvas, locale: "en" | "ar") => shown(canvas, step("consultant_qa").name[locale]);

/** V2 01: the draft open, nothing selected: the palette, the canvas, how to work it, what the draft holds and its problems. */
export const Draft: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await ready(canvas, locale);
    await expect(canvas.getByRole("heading", { level: 1, name: workflowName[locale] })).toBeVisible();
    await expect(canvas.getByText(labels.draft("4"), { exact: false })).toBeVisible();
    await expect(canvas.getByText(labels.nothingSelected)).toBeVisible();
    await expect(canvas.getByText(labels.tipsHeading)).toBeVisible();
    // 6 Steps and 15 Transitions, in each language's plural.
    await expect(canvas.getByText(labels.counts({ steps: 6, stepsN: "6", transitions: 15, transitionsN: "15" }))).toBeVisible();
    const errors = builderProblemsOf(builderDraft).filter((p) => p.severity === "error").length;
    await expect(canvas.getByText(labels.errors(errors, String(errors)))).toBeVisible();
    await expect(canvas.getByRole("button", { name: labels.undo })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: labels.autoLayout })).toBeVisible();
    await expect(canvas.getByRole("radio", { name: labels.curved })).toHaveAttribute("aria-checked", "true");
    // The Steps with an error wear a badge; the overview carries no attribution.
    await expect(canvas.getAllByRole("img", { name: labels.map.error! }).length).toBeGreaterThan(0);
    await expect(canvas.queryByText("React Flow")).toBeNull();
  },
};

/** V2 02: a Step selected by its card: who holds it, a pool hint that names no one, and its Transitions. */
export const StepSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "draft", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("Contractor Engineer");
    await expect(editor.getByLabelText(labels.nameAr)).toHaveValue("مهندس المقاول");
    await expect(editor.getByText(labels.poolHint(`${labels.map.role("contractor")} · ${labels.map.permission("create")}`))).toBeVisible();
    await expect(editor.getByText(labels.transitionsFrom("2"))).toBeVisible();
    // The raiser's Draft Step: its Form setting (ADR 0019), and who reads Drafts.
    await expect(editor.getByRole("switch", { name: labels.editsForm })).toBeVisible();
    await expect(editor.getAllByText(labels.draftsVisibleTo).length).toBeGreaterThan(0);
  },
};

/** A Send Back to the Draft Step (ADR 0021): what the raiser may change after it, "Comment only" until set. */
const sentBackDraft: WorkflowDefinition = {
  ...builderDraft,
  transitions: [
    ...builderDraft.transitions,
    {
      key: "send_back_for_comment",
      label: { en: "Return for Comment", ar: "إرجاع للتعليق" },
      kind: "send_back",
      from: "consultant_manager",
      to: "draft",
      outcome: null,
      permission: "approve",
      actionForm: null,
    },
  ],
};

/** The raiser's Step a Send Back leads to: "After a Send Back", set to "Edit the Form". */
export const StepAfterSendBack: Story = {
  args: { definition: sentBackDraft, problems: builderProblemsOf(sentBackDraft) },
  render,
  play: async ({ args, canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "draft", locale);
    const editor = editorOf(canvas, labels);
    const setting = editor.getByRole("combobox", { name: labels.afterSendBack });
    await expect(setting).toHaveTextContent(labels.afterSendBackComment);
    await expect(editor.getByText(labels.afterSendBackHelp)).toBeVisible();
    await userEvent.click(setting);
    await userEvent.click(within(document.body).getByRole("option", { name: labels.afterSendBackEditForm }));
    await expect(args.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ key: "draft", afterSendBack: "edit_form" })]) }),
    );
    await expect(editorOf(canvas, labels).getByRole("combobox", { name: labels.afterSendBack })).toHaveTextContent(labels.afterSendBackEditForm);
    // A Step no Send Back leads to has no such setting.
    await pickStep(canvas, "contractor_pm", locale);
    await expect(editorOf(canvas, labels).queryByRole("combobox", { name: labels.afterSendBack })).toBeNull();
  },
};

/** V2 05: the deciding Step: its outcome, and its six Transitions, one of which is picked from the list. */
export const StepManager: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "consultant_manager", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByRole("combobox", { name: labels.outcomeHeading })).toHaveTextContent(labels.outcomeOption("issue_outcome"));
    await expect(editor.getByText(labels.transitionsFrom("6"))).toBeVisible();
    // Not the raiser's: no Form editing to offer (ADR 0019).
    await expect(editor.queryByText(labels.editsForm)).toBeNull();
    await userEvent.click(editor.getByRole("button", { name: new RegExp(transition("approve_a").label[locale]) }));
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Approve – Code A");
  },
};

/** V2 07: the Step with no way forward: its error badge, and the hint to drag a Transition from it. */
export const StepDeadEnd: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "consultant_qa", locale);
    await expect(editorOf(canvas, labels).getByText(labels.deadEndHint)).toBeVisible();
  },
};

/** V2 08: an End selected: its name, what an End does, the Transitions into it, and Delete End. */
export const EndSelected: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, step("consultant_qa").name[locale]);
    await userEvent.click(canvas.getAllByText(step("approved").name[locale]).at(-1)!);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByText(labels.endHint)).toBeVisible();
    await expect(editor.getByText(labels.incoming("3"))).toBeVisible();
    await expect(editor.getByRole("button", { name: labels.deleteEnd })).toBeVisible();
  },
};

/** V2 10: a Send selected: its route, label, Type, the Action Form's blocks for its Screen (here the Internal Note only), and the Notifications inline. */
export const TransitionSend: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "send_for_review", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Send for Review");
    await expect(editor.getByRole("radio", { name: labels.map.kind("send") })).toBeChecked();
    await expect(editor.getByRole("combobox", { name: labels.screen })).toHaveTextContent(labels.screenNone);
    await expect(editor.getByText(labels.internalNoteBlock)).toBeVisible();
    await expect(editor.getByRole("button", { name: labels.previewPopup })).toBeVisible();
    await expect(editor.getByRole("group", { name: labels.rules.recipients })).toBeVisible();
  },
};

/** V2 15: Code B's reply: its Screen's blocks, the table of Comments it creates, and Edit in Screens. */
export const TransitionCodeB: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "approve_b", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByRole("combobox", { name: labels.outcomeReviewCode })).toBeEnabled();
    await expect(editor.getByRole("combobox", { name: labels.screen })).toHaveTextContent(builderScreens[2]!.name[locale]);
    await expect(editor.getByText(labels.createsItemsOf(locale === "ar" ? "ملاحظة" : "Comment"))).toBeVisible();
    await expect(editor.getByRole("link", { name: labels.editInScreens })).toHaveAttribute("href", "#screens");
  },
};

/** V2 17: the conditional Transition: its condition row (field, operator, value as wide as the field), and its error on the canvas. */
export const TransitionCondition: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "send_to_owner", locale);
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.labelEn)).toHaveValue("Send to Owner Rep");
    await expect(editor.getByRole("radio", { name: labels.map.kind("submit") })).toBeChecked();
    // Only a Close sets an outcome: on a Submit it is off, and says why.
    await expect(editor.getByText(labels.outcomeOnlyOnClose)).toBeVisible();
    const value = editor.getByLabelText(new RegExp(labels.rules.value)) as HTMLInputElement;
    await expect(value.value).toBe("500000");
    // As wide as the field's picker (the review's "5" of 500000 was the value squeezed).
    await expect(value.getBoundingClientRect().width).toBeGreaterThan(60);
  },
};

/** V2 29: "Preview pop-up": the Screen as the holder sees it; Confirm waits for what is required, and saves nothing. */
export const PreviewPopup: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "return_to_engineer", locale);
    await userEvent.click(editorOf(canvas, labels).getByRole("button", { name: labels.previewPopup }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await expect(dialog.getByText(labels.requiredMissing(locale === "ar" ? "السبب" : "Reason"))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.confirm })).toBeDisabled();
  },
};

/** V2 30: a Transition from a Step that recommends a code: its pop-up asks the Recommended Code, as the Transition dialog does. */
export const PreviewRecommend: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickTransition(canvas, "send_to_manager", locale);
    await userEvent.click(editorOf(canvas, labels).getByRole("button", { name: labels.previewPopup }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    const codes = within(dialog.getByRole("radiogroup", { name: labels.recommendCode }));
    await expect(codes.getAllByRole("radio")).toHaveLength(4);
    await userEvent.click(codes.getByRole("radio", { name: new RegExp(labels.codeChip("B")) }));
    await expect(codes.getByRole("radio", { name: new RegExp(labels.codeChip("B")) })).toHaveAttribute("aria-checked", "true");
  },
};

/** V2 36: Validate:the toast counts the errors to fix, and the first error is selected. */
export const ValidateToast: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await ready(canvas, locale);
    await userEvent.click(canvas.getByRole("button", { name: labels.validate }));
    const errors = builderProblemsOf(builderDraft).filter((p) => p.severity === "error").length;
    await expect(await within(document.body).findByText(labels.errorsToFix(errors, String(errors)))).toBeVisible();
    await expect(editorOf(canvas, labels).getByText(labels.deadEndHint)).toBeVisible();
  },
};

/** V2 38: adding a Step from the palette (by keyboard too): it is selected, the draft is unsaved, and the check finds its dead end. */
export const AddStep: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await ready(canvas, locale);
    const palette = within(canvas.getByRole("complementary", { name: labels.palette }));
    palette.getByRole("button", { name: labels.step }).focus();
    await userEvent.keyboard("{Enter}");
    const editor = editorOf(canvas, labels);
    await expect(editor.getByLabelText(labels.nameEn)).toHaveValue("New step");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ key: "new_step" })]) }));
    await expect(canvas.getByText(labels.unsaved, { exact: false })).toBeVisible();
    await shown(canvas, labels.names.newStep[locale]);
  },
};

/** V2 40: a ready-made pair of Steps added from the palette, then undone. */
export const AddReadyMade: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await ready(canvas, locale);
    const palette = within(canvas.getByRole("complementary", { name: labels.palette }));
    await userEvent.click(palette.getByRole("button", { name: labels.templateInternal }));
    await shown(canvas, labels.names.engineerReview[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.undo }));
    await waitFor(() => expect(canvas.queryByText(labels.names.engineerReview[locale])).toBeNull());
  },
};

/** V2 47: "Add a Transition to" from a Step: named by its kind, selected, and a toast says so. */
export const AddTransition: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await pickStep(canvas, "contractor_pm", locale);
    await userEvent.click(editorOf(canvas, labels).getByRole("combobox", { name: labels.addTransitionTo }));
    await userEvent.click(within(document.body).getByRole("option", { name: step("cancelled").name[locale] }));
    await expect(editorOf(canvas, labels).getByLabelText(labels.labelEn)).toHaveValue("Cancel");
    await expect(editorOf(canvas, labels).getByRole("radio", { name: labels.map.kind("cancel") })).toBeChecked();
    await expect(await within(document.body).findByText(labels.addedTransition(labels.names.cancel[locale]))).toBeVisible();
  },
};

/** V2 53: the arrows at right angles (each viewer's own choice, kept in the browser). */
export const Orthogonal: Story = {
  render,
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await ready(canvas, locale);
    await userEvent.click(canvas.getByRole("radio", { name: labels.orthogonal }));
    await expect(canvas.getByRole("radio", { name: labels.orthogonal })).toHaveAttribute("aria-checked", "true");
  },
};

/** The sampled field's name (the Form's cost impact), as the bar labels its input. */
const costLabel = { en: "Cost impact", ar: "أثر التكلفة" };

/** Takes the test run from the Draft Step to the Consultant Manager's decision, skipping each pop-up. */
const toManager = async (canvas: Canvas, locale: "en" | "ar") => {
  const labels = workflowBuilderLabels(locale);
  await shown(canvas, step("draft").name[locale]);
  await userEvent.click(canvas.getByRole("button", { name: labels.testRun }));
  const bar = within(canvas.getByRole("region", { name: labels.testRun }));
  for (const key of ["send_for_review", "submit", "send_to_manager"]) {
    await userEvent.click(bar.getByRole("button", { name: transition(key).label[locale] }));
    await userEvent.click(within(await within(document.body).findByRole("dialog")).getByRole("button", { name: labels.skip }));
  }
  return bar;
};

/** V2 58-60: a test run: each move opens its pop-up in test mode; confirmed, nothing is saved, and the path stays lit. */
export const TestRun: Story = {
  render,
  args: { definition: builderDraftSampled },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, step("draft").name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.testRun }));
    await expect(canvas.getByRole("button", { name: labels.testRun })).toHaveAttribute("aria-pressed", "true");
    const bar = within(canvas.getByRole("region", { name: labels.testRun }));
    await userEvent.click(bar.getByRole("button", { name: transition("send_for_review").label[locale] }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: labels.confirm }));
    await expect(await within(document.body).findByText(labels.testRecorded)).toBeVisible();
    await expect(bar.getByText(step("contractor_pm").name[locale])).toBeVisible();
  },
};

/** V2 62: the sample's cost impact (620,000 SAR) is over 500,000, so the conditional "Send to Owner Rep" is offered. */
export const TestRunCondition: Story = {
  render,
  args: { definition: builderDraftSampled },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const bar = await toManager(canvas, locale);
    await expect(bar.getByRole("textbox", { name: costLabel[locale] })).toHaveValue("620,000");
    await expect(bar.getByRole("button", { name: transition("send_to_owner").label[locale] })).toBeVisible();
  },
};

/** V2 63: a low cost impact: the conditional Transition isn't offered. */
export const TestRunLowCost: Story = {
  render,
  args: { definition: builderDraftSampled },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const bar = await toManager(canvas, locale);
    const cost = bar.getByRole("textbox", { name: costLabel[locale] });
    await userEvent.clear(cost);
    await userEvent.type(cost, "120000");
    await userEvent.tab();
    await waitFor(() => expect(bar.queryByRole("button", { name: transition("send_to_owner").label[locale] })).toBeNull());
    await expect(bar.getByRole("button", { name: transition("approve_a").label[locale] })).toBeVisible();
  },
};

/** V2 66: the run reaches an outcome: "Finished: Approved". */
export const TestRunFinished: Story = {
  render,
  args: { definition: builderDraftSampled },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    const bar = await toManager(canvas, locale);
    await userEvent.click(bar.getByRole("button", { name: transition("approve_a").label[locale] }));
    await userEvent.click(within(await within(document.body).findByRole("dialog")).getByRole("button", { name: labels.skip }));
    await expect(bar.getByText(labels.finished(step("approved").name[locale]))).toBeVisible();
  },
};

/** V2 67-68: publishing refused: the server's check finds errors, Publish stays off, and "Show first error" goes to it. */
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
    await ready(canvas, locale);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    const errors = builderProblemsOf(builderDraft).filter((p) => p.severity === "error").length;
    await expect(await dialog.findByText(labels.errorsBlock(errors, String(errors)))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: labels.showFirstError })).toBeVisible();
  },
};

/** V2 71: publishing a fixed draft: what changed since v3, the check passed, the change note, and how many items keep their Version. */
export const Publish: Story = {
  render,
  args: { definition: fixedDraft },
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, step("draft").name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await expect(dialog.getByText(labels.changesSince("3"))).toBeVisible();
    await expect(await dialog.findByText(labels.passed)).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: labels.changeNote })).toHaveFocus();
    await expect(dialog.getByText(labels.keepVersions({ latest: 31, latestN: "31", older: 16, olderN: "16", version: "3", next: "4" }))).toBeVisible();
    await expect(dialog.getByRole("button", { name: labels.publishVersion("4") })).toBeEnabled();
  },
};

/** V2 72: Publish without a change note is refused in the dialog. */
export const PublishNoteRequired: Story = {
  render,
  args: { definition: fixedDraft },
  parameters: { overlay: true },
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, step("draft").name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await dialog.findByText(labels.passed);
    await userEvent.click(dialog.getByRole("button", { name: labels.publishVersion("4") }));
    await expect(dialog.getByText(labels.changeNoteRequired)).toBeVisible();
    await expect(args.onPublish).not.toHaveBeenCalled();
  },
};

/** V2 73: published with a note: the builder stays, the badge says "Published v4", Publish rests, and the toast links to the Versions. */
export const Published: Story = {
  render,
  args: { definition: fixedDraft },
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, step("draft").name[locale]);
    await userEvent.click(canvas.getByRole("button", { name: labels.publish }));
    const dialog = within(await within(document.body).findByRole("dialog"));
    await dialog.findByText(labels.passed);
    await userEvent.type(dialog.getByRole("textbox", { name: labels.changeNote }), "Added the QA check.");
    await userEvent.click(dialog.getByRole("button", { name: labels.publishVersion("4") }));
    await expect(args.onPublish).toHaveBeenCalledWith("Added the QA check.");
    // The badge, and the side panel's heading over the counts.
    await expect(await canvas.findAllByText(labels.publishedBadge("4"))).toHaveLength(2);
    await expect(canvas.getByRole("button", { name: labels.publish })).toBeDisabled();
    await expect(await within(document.body).findByRole("link", { name: labels.viewVersions })).toHaveAttribute("href", "#versions/4");
  },
};

/** A blank Workflow starts with one Draft Step, selected; the page saves it, and the check says it has no way forward. */
export const BlankWorkflow: Story = {
  args: { definition: { steps: [], transitions: [], layout: {} }, published: null, running: [] },
  render,
  play: async ({ canvas, context, args }) => {
    const locale = storyLocale(context);
    const labels = workflowBuilderLabels(locale);
    await shown(canvas, labels.names.firstStep![locale]);
    await expect(editorOf(canvas, labels).getByLabelText(labels.nameEn)).toHaveValue("Contractor Engineer");
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ steps: [expect.objectContaining({ key: "contractor_engineer", stage: "draft" })] }));
    await expect(canvas.getAllByRole("button", { name: new RegExp(labels.showProblem("").trim()) }).length).toBeGreaterThan(0);
    await expect(canvas.queryByText(labels.noErrors)).toBeNull();
  },
};

/** The V2 draft with its condition on the Form's cost impact, as opened: where the V2 test-run states start. */
export const Sampled: Story = { render, args: { definition: builderDraftSampled } };

/** The V2 draft with its errors fixed (V2 69), as opened: where the V2 publish states start. */
export const Fixed: Story = {
  render,
  args: { definition: fixedDraft },
  play: async ({ canvas, context }) => {
    const labels = workflowBuilderLabels(storyLocale(context));
    await expect(await canvas.findByText(labels.noErrors)).toBeVisible();
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
  args: { saveState: { kind: "failed" }, definition: fixedDraft },
  render,
  play: async ({ canvas, context }) => {
    const labels = workflowBuilderLabels(storyLocale(context));
    await expect(canvas.getByText(labels.saveFailed, { exact: false })).toBeVisible();
    await expect(canvas.getByText(labels.noErrors)).toBeVisible();
  },
};
