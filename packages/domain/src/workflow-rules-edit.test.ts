import { describe, expect, it } from "vitest";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./workflow-definition.ts";
import {
  addRule,
  changeConditionKind,
  conditionKindOf,
  defaultRule,
  isRuleComplete,
  notificationChoices,
  retargetComparison,
  operatorsFor,
  removeRule,
  ruleFieldsOf,
  ruleKindOf,
  setRecipient,
  updateRule,
  valueInputFor,
  type RuleField,
} from "./workflow-rules-edit.ts";
import { workflowRuleProblemsOf } from "./workflow-rules-edit.ts";
import { formSchema } from "./form.ts";

// Pure domain: the Workflow builder's rule, action and notification edits (RP-440,
// WF-17; workflow-engine.md §11). The "Add rule" dialog and the Notifications tab
// change a Transition through these, and the result is saved through WF-4's API.

const t = (en: string, ar: string) => ({ en, ar });

const base: WorkflowDefinition = {
  steps: [
    { key: "draft", name: t("Draft", "مسودة"), stage: "draft", actor: { role: "contractor", permission: "create" }, outcomeMode: "none" },
    { key: "review", name: t("Review", "مراجعة"), stage: "pending_approval", actor: { role: "consultant", permission: "approve" }, outcomeMode: "issue_outcome" },
    { key: "approved", name: t("Approved", "معتمد"), stage: "approved", actor: null, outcomeMode: "none" },
  ],
  transitions: [
    { key: "submit", label: t("Submit", "تقديم"), kind: "submit", from: "draft", to: "review", outcome: null, permission: "submit", actionForm: null },
    { key: "approve", label: t("Approve", "اعتماد"), kind: "close", from: "review", to: "approved", outcome: "A", permission: "approve", actionForm: null },
  ],
  layout: {},
};

const form = formSchema.parse({
  sections: [
    {
      key: "general",
      title: t("General", "عام"),
      fields: [
        { key: "heading", type: "heading", text: t("Details", "تفاصيل") },
        { key: "cost_impact", type: "number", label: t("Cost impact", "أثر التكلفة") },
        { key: "subject", type: "text", label: t("Subject", "الموضوع") },
        { key: "category", type: "select", label: t("Category", "الفئة"), options: [{ value: "civil", label: t("Civil", "مدني") }, { value: "mep", label: t("MEP", "ميكانيكا") }] },
        { key: "needed_by", type: "date", label: t("Needed by", "مطلوب قبل") },
        { key: "drawings", type: "attachments", label: t("Drawings", "المخططات") },
      ],
    },
  ],
});

const fields = ruleFieldsOf(form, null);
const field = (key: string): RuleField => fields.find((f) => f.key === key)!;

describe("the fields a rule can name", () => {
  it("lists the Form's fields that take answers, not its headings", () => {
    expect(fields.map((f) => f.key)).toEqual(["cost_impact", "subject", "category", "needed_by", "drawings"]);
    expect(field("category")).toMatchObject({ type: "select", label: t("Category", "الفئة"), options: [{ value: "civil" }, { value: "mep" }] });
  });

  it("adds the Transition's own Action Form fields after the Form's, marked as its own", () => {
    const actionForm = { sections: [{ key: "reply", title: t("Reply", "الرد"), fields: [{ key: "remarks", type: "textarea", label: t("Remarks", "الملاحظات") }] }] };
    const both = ruleFieldsOf(form, actionForm);
    expect(both.map((f) => [f.key, f.source])).toEqual([
      ["cost_impact", "form"],
      ["subject", "form"],
      ["category", "form"],
      ["needed_by", "form"],
      ["drawings", "form"],
      ["remarks", "action_form"],
    ]);
  });

  it("is empty for a Type with no published Form", () => {
    expect(ruleFieldsOf(null, null)).toEqual([]);
  });
});

describe("adding, editing and removing a rule", () => {
  const filled = { type: "condition" as const, condition: { field: "subject", op: "not_empty" as const }, message: t("Add a subject.", "أضف موضوعًا.") };

  it("adds each kind of rule to its list on the Transition, leaving the other Transition and the draft it came from alone", () => {
    let d = addRule(base, "submit", { group: "restrict", rule: { type: "positions", positions: ["manager"] } });
    d = addRule(d, "submit", { group: "restrict", rule: { type: "all_closed", items: "comments" } });
    d = addRule(d, "submit", { group: "validate", rule: filled });
    d = addRule(d, "submit", { group: "validate", rule: { type: "form_complete" } });
    d = addRule(d, "submit", { group: "action", rule: { type: "offer_assign_to" } });
    d = addRule(d, "submit", { group: "action", rule: { type: "set_field", field: "subject", value: "Reviewed" } });
    d = addRule(d, "submit", { group: "action", rule: { type: "copy_field", from: "subject", to: "category" } });
    const submit = d.transitions[0]!;
    expect(submit.rules).toEqual({
      restrict: [{ type: "positions", positions: ["manager"] }, { type: "all_closed", items: "comments" }],
      validate: [filled, { type: "form_complete" }],
    });
    expect(submit.actions).toEqual([{ type: "offer_assign_to" }, { type: "set_field", field: "subject", value: "Reviewed" }, { type: "copy_field", from: "subject", to: "category" }]);
    expect(d.transitions[1]).toEqual(base.transitions[1]);
    expect(base.transitions[0]!.rules).toBeUndefined();
    // Whatever the builder writes fits the format the API saves.
    expect(parseWorkflowDefinition(d).ok).toBe(true);
  });

  it("replaces a rule in place, keeping its place in the list", () => {
    let d = addRule(base, "submit", { group: "restrict", rule: { type: "positions", positions: ["manager"] } });
    d = addRule(d, "submit", { group: "restrict", rule: { type: "all_closed", items: "comments" } });
    d = updateRule(d, "submit", { group: "restrict", index: 0 }, { group: "restrict", rule: { type: "positions", positions: ["manager", "engineer"] } });
    expect(d.transitions[0]!.rules!.restrict).toEqual([{ type: "positions", positions: ["manager", "engineer"] }, { type: "all_closed", items: "comments" }]);
  });

  it("removes a rule, and leaves no empty list behind, so a Transition without rules is stored as before", () => {
    let d = addRule(base, "submit", { group: "restrict", rule: { type: "all_closed", items: "subtasks" } });
    d = addRule(d, "submit", { group: "action", rule: { type: "offer_assign_to" } });
    d = removeRule(d, "submit", { group: "restrict", index: 0 });
    expect(d.transitions[0]).not.toHaveProperty("rules");
    d = removeRule(d, "submit", { group: "action", index: 0 });
    expect(d.transitions[0]).toEqual(base.transitions[0]);
  });

  it("removing one of two Validate rules keeps the other", () => {
    let d = addRule(base, "submit", { group: "validate", rule: { type: "form_complete" } });
    d = addRule(d, "submit", { group: "validate", rule: { type: "has_document" } });
    d = removeRule(d, "submit", { group: "validate", index: 0 });
    expect(d.transitions[0]!.rules).toEqual({ validate: [{ type: "has_document" }] });
  });
});

describe("the kind of a stored rule", () => {
  it("tells a field-filled Validate from a field-has-a-value one, both stored as a condition with a message", () => {
    expect(ruleKindOf({ group: "validate", rule: { type: "condition", condition: { field: "subject", op: "not_empty" }, message: t("a", "ا") } })).toBe("field_filled");
    expect(ruleKindOf({ group: "validate", rule: { type: "condition", condition: { field: "cost_impact", op: ">", value: 0 }, message: t("a", "ا") } })).toBe("field_value");
    expect(ruleKindOf({ group: "restrict", rule: { type: "condition", condition: { field: "cost_impact", op: ">", value: 0 } } })).toBe("field_value");
    expect(ruleKindOf({ group: "restrict", rule: { type: "been_through", fact: "sent_back" } })).toBe("been_through");
    expect(ruleKindOf({ group: "restrict", rule: { type: "not_same_person", transition: "submit" } })).toBe("not_same_person");
    expect(ruleKindOf({ group: "action", rule: { type: "set_field", field: "subject", value: "x" } })).toBe("set_field");
  });

  it("starts each kind from a rule the format accepts, on the Form's first suitable field", () => {
    const context = { fields, steps: base.steps, transitions: base.transitions, transitionKey: "approve" };
    expect(defaultRule("field_value", "restrict", context)).toEqual({ group: "restrict", rule: { type: "condition", condition: { field: "cost_impact", op: "=", value: 0 } } });
    expect(defaultRule("field_filled", "validate", context)).toMatchObject({ group: "validate", rule: { type: "condition", condition: { field: "cost_impact", op: "not_empty" } } });
    expect(defaultRule("has_document", "validate", context)).toEqual({ group: "validate", rule: { type: "has_document" } });
    expect(defaultRule("not_same_person", "restrict", context)).toEqual({ group: "restrict", rule: { type: "not_same_person", step: "draft" } });
    // "Been through" names a Step of the acting Participant's own role (the consultant's, for "approve").
    expect(defaultRule("been_through", "restrict", context)).toEqual({ group: "restrict", rule: { type: "been_through", fact: "sent_back" } });
    expect(defaultRule("copy_field", "action", context)).toEqual({ group: "action", rule: { type: "copy_field", from: "cost_impact", to: "subject" } });
  });

  it("offers no field rule when the Form has no fields", () => {
    const context = { fields: [], steps: base.steps, transitions: base.transitions, transitionKey: "submit" };
    expect(defaultRule("field_value", "restrict", context)).toBeNull();
    expect(defaultRule("set_field", "action", context)).toBeNull();
    expect(defaultRule("form_complete", "validate", context)).not.toBeNull();
  });
});

describe("conditions built without JSON", () => {
  it("offers each field type the operators that make sense for it", () => {
    expect(operatorsFor("number")).toEqual(["=", "!=", ">", ">=", "<", "<=", "empty", "not_empty"]);
    expect(operatorsFor("text")).toEqual(["=", "!=", "empty", "not_empty"]);
    expect(operatorsFor("select")).toEqual(["=", "!=", "in", "not_in", "empty", "not_empty"]);
    expect(operatorsFor("attachments")).toEqual(["empty", "not_empty"]);
  });

  it("says how the value is entered: none for empty, a number, a date, a choice, a few choices, Yes or No, text", () => {
    expect(valueInputFor(field("cost_impact"), ">")).toBe("number");
    expect(valueInputFor(field("cost_impact"), "not_empty")).toBe("none");
    expect(valueInputFor(field("needed_by"), "<")).toBe("date");
    expect(valueInputFor(field("category"), "=")).toBe("option");
    expect(valueInputFor(field("category"), "in")).toBe("options");
    expect(valueInputFor(field("subject"), "=")).toBe("text");
    expect(valueInputFor({ ...field("subject"), type: "yes_no" }, "=")).toBe("boolean");
  });

  it("turns a condition into a group of any kind and back, keeping what was built", () => {
    const one = { field: "cost_impact", op: ">" as const, value: 1000 };
    const two = { field: "subject", op: "not_empty" as const };
    expect(conditionKindOf(one)).toBe("comparison");
    expect(changeConditionKind(one, "all")).toEqual({ all: [one] });
    expect(changeConditionKind({ all: [one, two] }, "any")).toEqual({ any: [one, two] });
    expect(changeConditionKind({ any: [one, two] }, "not")).toEqual({ not: { any: [one, two] } });
    expect(changeConditionKind({ not: one }, "all")).toEqual({ all: [one] });
    expect(changeConditionKind({ all: [one, two] }, "comparison")).toEqual(one);
  });
});

describe("a rule that is ready to add", () => {
  it("needs Positions chosen, a message in both languages and no empty group", () => {
    expect(isRuleComplete({ group: "restrict", rule: { type: "positions", positions: [] } })).toBe(false);
    expect(isRuleComplete({ group: "restrict", rule: { type: "positions", positions: ["manager"] } })).toBe(true);
    expect(isRuleComplete({ group: "validate", rule: { type: "condition", condition: { field: "subject", op: "not_empty" }, message: t("Add one.", "") } })).toBe(false);
    expect(isRuleComplete({ group: "validate", rule: { type: "condition", condition: { field: "subject", op: "not_empty" }, message: t("Add one.", "أضف.") } })).toBe(true);
    expect(isRuleComplete({ group: "restrict", rule: { type: "condition", condition: { all: [] } } })).toBe(false);
    expect(isRuleComplete({ group: "restrict", rule: { type: "condition", condition: { any: [{ field: "category", op: "in", value: [] }] } } })).toBe(false);
    expect(isRuleComplete({ group: "action", rule: { type: "offer_assign_to" } })).toBe(true);
  });

  it("changes a comparison to another field or operator, keeping the value only while it still fits", () => {
    const over = { field: "cost_impact", op: ">" as const, value: 500 };
    expect(retargetComparison(over, field("cost_impact"), ">=")).toEqual({ field: "cost_impact", op: ">=", value: 500 }); // value kept: the field is the same
    expect(retargetComparison(over, field("cost_impact"), "not_empty")).toEqual({ field: "cost_impact", op: "not_empty" });
    expect(retargetComparison(over, field("category"))).toEqual({ field: "category", op: "=", value: "civil" }); // ">" doesn't fit a choice
    expect(retargetComparison({ field: "category", op: "=", value: "mep" }, field("category"), "in")).toEqual({ field: "category", op: "in", value: ["civil"] });
  });
});

describe("notifications", () => {
  it("adds and removes the raiser, the watchers and a Position of the acting Participant, each once", () => {
    let d = setRecipient(base, "submit", { to: "raiser" }, true);
    d = setRecipient(d, "submit", { to: "position", position: "manager" }, true);
    d = setRecipient(d, "submit", { to: "raiser" }, true);
    expect(d.transitions[0]!.notifications).toEqual([{ to: "raiser" }, { to: "position", position: "manager" }]);
    d = setRecipient(d, "submit", { to: "raiser" }, false);
    expect(d.transitions[0]!.notifications).toEqual([{ to: "position", position: "manager" }]);
    d = setRecipient(d, "submit", { to: "position", position: "manager" }, false);
    expect(d.transitions[0]).toEqual(base.transitions[0]);
    expect(parseWorkflowDefinition(setRecipient(base, "submit", { to: "watchers" }, true)).ok).toBe(true);
  });

  it("always notifies the next holder, so that choice is on and not stored", () => {
    const choices = notificationChoices(base.transitions[0]!, base.steps, [
      { role: "contractor", key: "engineer", name: t("Engineer", "مهندس") },
      { role: "consultant", key: "manager", name: t("Manager", "مدير") },
    ]);
    expect(choices.holder).toEqual({ always: true });
    expect(choices.raiser).toBe(false);
    expect(choices.watchers).toBe(false);
    // Positions of the acting Participant: the role of the Transition's source Step.
    expect(choices.positions).toEqual([{ key: "engineer", name: t("Engineer", "مهندس"), on: false }]);
  });

  it("ticks what the Transition already names", () => {
    const d = setRecipient(setRecipient(base, "submit", { to: "watchers" }, true), "submit", { to: "position", position: "engineer" }, true);
    const choices = notificationChoices(d.transitions[0]!, d.steps, [{ role: "contractor", key: "engineer", name: t("Engineer", "مهندس") }]);
    expect(choices.watchers).toBe(true);
    expect(choices.positions[0]!.on).toBe(true);
  });
});

describe("the publish problems of a Transition's rules", () => {
  it("keeps the problems that name this Transition's rules, not others", () => {
    const problems = [
      { code: "unknown_field", severity: "error", transition: "submit", detail: "gone", message: t("x", "x") },
      { code: "dead_end_step", severity: "error", step: "review", message: t("y", "y") },
      { code: "unknown_step", severity: "error", transition: "approve", detail: "nope", message: t("z", "z") },
    ] as const;
    expect(workflowRuleProblemsOf(problems, "submit").map((p) => p.code)).toEqual(["unknown_field"]);
  });
});
