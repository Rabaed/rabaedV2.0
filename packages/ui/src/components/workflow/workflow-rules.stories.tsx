import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { storyLocale } from "../../storybook/locale.ts";
import {
  builderDraft,
  builderFields,
  builderOutcomes,
  builderPositions,
  builderProblems,
  twoTierReview,
  workflowBuilderLabels,
  workflowStages,
} from "../../storybook/workflow.ts";
import { WorkflowBuilder, type WorkflowBuilderProps } from "./workflow-builder.tsx";

// The builder's rules and notifications (RP-440, WF-17): a Transition's rules listed
// as the design lists its Condition, the "Add rule" dialog (Restrict, Validate,
// Actions) and the Notifications tab. The Transition is "Send to Owner Rep".

const meta = {
  title: "Workflow/WorkflowBuilderRules",
  component: WorkflowBuilder,
  args: {
    name: "Material Submittal – 2-tier review",
    versionNo: 4,
    published: { versionNo: 3, definition: twoTierReview },
    definition: builderDraft,
    stages: workflowStages,
    outcomes: builderOutcomes,
    positions: builderPositions,
    fields: builderFields,
    locale: "en",
    labels: workflowBuilderLabels("en"),
    problems: builderProblems,
    saveState: { kind: "saved" as const, at: new Date("2026-10-10T11:32:00Z") },
    backHref: "#workflows",
    onChange: fn(),
    onValidate: fn(async () => builderProblems),
    onPublish: fn(async () => ({ ok: true as const, versionNo: 4 })),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkflowBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

function Frame(props: WorkflowBuilderProps) {
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

const TRANSITION = "send_to_owner";

/** Selects "Send to Owner Rep" through its validation warning, and returns the side editor. */
async function openTransition(canvas: ReturnType<typeof within>, context: Parameters<NonNullable<Story["play"]>>[0]["context"]) {
  const locale = storyLocale(context);
  const labels = workflowBuilderLabels(locale);
  await waitFor(async () => expect(await canvas.findByText(builderDraft.steps[0]!.name[locale])).toBeVisible());
  await userEvent.click(canvas.getByRole("button", { name: labels.showProblem(builderProblems[1]!.message[locale]) }));
  return { locale, labels, rules: labels.rules, editor: within(canvas.getByRole("complementary", { name: labels.editor })) };
}

const dialogOf = async () => within(await within(document.body).findByRole("dialog"));

/** The change a story's `onChange` last received: the Transition with its rules. */
const lastTransition = (onChange: ReturnType<typeof fn>) => {
  const calls = onChange.mock.calls;
  const definition = calls.at(-1)?.[0] as typeof builderDraft;
  return definition.transitions.find((t) => t.key === TRANSITION)!;
};

/**
 * The Transition's rules as the design lists its Condition: the cost-impact row edited in
 * place (field, operator, value, remove), the other rules one line each with edit and
 * remove, "Add rule" under them, and the warning about them from the server's check.
 */
export const TransitionRules: Story = {
  render,
  play: async ({ canvas, context }) => {
    const { rules, editor, locale } = await openTransition(canvas, context);
    const section = within(editor.getByRole("region", { name: rules.heading }));
    await expect(section.getByRole("combobox", { name: `${rules.field} · ${rules.groupTitle("restrict")} 1` })).toHaveTextContent(builderFields[1]!.label[locale]);
    await expect(section.getByText(rules.and)).toBeVisible();
    await expect(section.getByText(rules.summaryPositions(builderPositions[3]!.name[locale]))).toBeVisible();
    await expect(section.getByText(rules.groupTitle("validate"))).toBeVisible();
    await expect(section.getByText(rules.groupTitle("action"))).toBeVisible();
    await expect(section.getByRole("button", { name: rules.addRule })).toBeVisible();
    await expect(section.getByText(builderProblems[1]!.message[locale])).toBeVisible();
  },
};

/** "Add rule" opens the dialog grouped like Jira: Restrict, Validate and Actions, each kind with what it does. */
export const AddRuleDialog: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const { rules, editor } = await openTransition(canvas, context);
    await userEvent.click(editor.getByRole("button", { name: rules.addRule }));
    const dialog = await dialogOf();
    for (const group of ["restrict", "validate", "action"] as const) await expect(dialog.getByText(rules.groupTitle(group))).toBeVisible();
    for (const kind of ["field_value", "positions", "not_same_person", "been_through", "all_closed", "field_filled", "form_complete", "has_document", "offer_assign_to", "set_field", "copy_field"] as const) {
      await expect(dialog.getAllByText(rules.kindTitle(kind)).length).toBeGreaterThan(0);
    }
    await expect(dialog.getByRole("button", { name: rules.next })).toBeDisabled();
  },
};

/**
 * A condition built without JSON: a comparison on a field of the Form (the picker lists
 * the Form's fields and no others), grown into any of several, with a group inside.
 */
export const ConditionBuilt: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const { rules, editor, locale } = await openTransition(canvas, context);
    await userEvent.click(editor.getByRole("button", { name: rules.addRule }));
    let dialog = await dialogOf();
    // Restrict's "Field value" is the first of the two radios by that title.
    await userEvent.click(dialog.getAllByRole("radio", { name: new RegExp(rules.kindTitle("field_value")) })[0]!);
    await userEvent.click(dialog.getByRole("button", { name: rules.next }));
    dialog = await dialogOf();

    const picker = dialog.getByRole("combobox", { name: `${rules.field} · ${rules.kindTitle("field_value")}` });
    await userEvent.click(picker);
    const options = within(document.body).getAllByRole("option").map((o) => o.textContent);
    await expect(options).toEqual(builderFields.map((f) => f.label[locale]));
    await userEvent.keyboard("{Escape}");

    await userEvent.click(dialog.getByRole("button", { name: rules.addCondition }));
    await userEvent.click(dialog.getByRole("combobox", { name: new RegExp(`^${rules.conditionKind}`) }));
    await userEvent.click(within(document.body).getByRole("option", { name: rules.conditionKindName("any") }));
    await userEvent.click(dialog.getByRole("button", { name: rules.addGroup }));
    await expect(dialog.getAllByRole("group", { name: rules.conditionKindName("all") }).length).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: rules.add })).toBeEnabled();
  },
};

/** A Validate rule needs its message in both languages before it can be added. */
export const ValidateMessage: Story = {
  render,
  parameters: { overlay: true },
  play: async ({ canvas, context }) => {
    const { rules, editor } = await openTransition(canvas, context);
    await userEvent.click(editor.getByRole("button", { name: rules.addRule }));
    let dialog = await dialogOf();
    // Two radios share that title (Restrict and Validate): the Validate one is the second.
    await userEvent.click(dialog.getAllByRole("radio", { name: new RegExp(rules.kindTitle("field_value")) })[1]!);
    await userEvent.click(dialog.getByRole("button", { name: rules.next }));
    dialog = await dialogOf();
    await expect(dialog.getByRole("button", { name: rules.add })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(rules.messageEn, { exact: false }), "Check the budget first.");
    await userEvent.type(dialog.getByLabelText(rules.messageAr, { exact: false }), "تحقق من الميزانية أولًا.");
    await expect(dialog.getByRole("button", { name: rules.add })).toBeEnabled();
  },
};

/** Adding a rule by keyboard: it joins the Transition's list and the edit reaches `onChange`. */
export const RuleAdded: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const { rules, editor } = await openTransition(canvas, context);
    editor.getByRole("button", { name: rules.addRule }).focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await dialogOf();
    const radio = dialog.getByRole("radio", { name: new RegExp(rules.kindTitle("all_closed")) });
    radio.focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await within(await within(document.body).findByRole("dialog")).findByRole("button", { name: rules.add }));
    await waitFor(() => expect(lastTransition(args.onChange as ReturnType<typeof fn>).rules?.restrict).toContainEqual({ type: "all_closed", items: "comments" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
  },
};

/** Editing a rule opens its editor; saving replaces it in place. */
export const RuleEdited: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const { rules, editor, locale } = await openTransition(canvas, context);
    const summary = rules.summaryPositions(builderPositions[3]!.name[locale]);
    await userEvent.click(editor.getByRole("button", { name: rules.edit(summary) }));
    const dialog = await dialogOf();
    await userEvent.click(dialog.getByRole("checkbox", { name: builderPositions[2]!.name[locale] }));
    await userEvent.click(dialog.getByRole("button", { name: rules.save }));
    await waitFor(() => expect(lastTransition(args.onChange as ReturnType<typeof fn>).rules?.restrict?.[1]).toEqual({ type: "positions", positions: ["manager", "engineer"] }));
  },
};

/** Removing a rule takes it off the Transition. */
export const RuleRemoved: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const { rules, editor, locale } = await openTransition(canvas, context);
    const summary = rules.summaryPositions(builderPositions[3]!.name[locale]);
    await userEvent.click(editor.getByRole("button", { name: rules.remove(summary) }));
    await waitFor(() => expect(lastTransition(args.onChange as ReturnType<typeof fn>).rules?.restrict).toHaveLength(1));
    await expect(editor.queryByText(summary)).toBeNull();
  },
};

/**
 * The Notifications tab: the next holder or Step Pool is always told; the raiser,
 * watchers and a Position of the acting Participant are chosen; in-app is always on,
 * email follows each Member's settings and SMS is not set up yet.
 */
export const NotificationsTab: Story = {
  render,
  play: async ({ canvas, context, args }) => {
    const { rules, editor } = await openTransition(canvas, context);
    await userEvent.click(editor.getByRole("tab", { name: rules.tabNotifications }));
    const holder = editor.getByRole("button", { name: rules.holder });
    await expect(holder).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByRole("button", { name: rules.raiser })).toHaveAttribute("aria-pressed", "true");
    const watchers = editor.getByRole("button", { name: rules.watchers });
    await expect(watchers).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(watchers);
    await waitFor(() => expect(lastTransition(args.onChange as ReturnType<typeof fn>).notifications).toEqual([{ to: "raiser" }, { to: "watchers" }]));
    await expect(editor.getByText(rules.inAppHelp)).toBeVisible();
    await expect(editor.getByText(rules.emailHelp)).toBeVisible();
    await expect(editor.getByText(rules.smsHelp)).toBeVisible();
    await userEvent.click(editor.getByRole("button", { name: builderPositions[3]!.name[storyLocale(context)] }));
    await waitFor(() => expect(lastTransition(args.onChange as ReturnType<typeof fn>).notifications).toContainEqual({ to: "position", position: "manager" }));
  },
};
