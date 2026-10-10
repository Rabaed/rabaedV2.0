import { describe, expect, it } from "vitest";
import {
  addStep,
  connectSteps,
  definitionChanges,
  moveStep,
  removeStep,
  removeTransition,
  updateStep,
  updateTransition,
  type WorkflowEditResult,
} from "./workflow-edit.ts";
import type { WorkflowDefinition } from "./workflow-definition.ts";

// Pure domain: the Workflow builder's edits (RP-439, WF-16; workflow-engine.md §11).
// The builder and the seam-1 test both change a draft through these, and the result
// is saved through WF-4's API, which checks it again.

const t = (en: string, ar: string) => ({ en, ar });

const base: WorkflowDefinition = {
  steps: [
    { key: "draft", name: t("Draft", "مسودة"), stage: "draft", actor: { role: "contractor", permission: "create" }, outcomeMode: "none" },
    { key: "consultant_review", name: t("Consultant review", "مراجعة الاستشاري"), stage: "pending_approval", actor: { role: "consultant", permission: "approve" }, outcomeMode: "issue_outcome" },
    { key: "approved", name: t("Approved", "معتمد"), stage: "approved", actor: null, outcomeMode: "none" },
  ],
  transitions: [
    { key: "submit", label: t("Submit", "تقديم"), kind: "submit", from: "draft", to: "consultant_review", outcome: null, permission: "submit", actionForm: null },
    { key: "approve_a", label: t("Approve – Code A", "اعتماد – Code A"), kind: "close", from: "consultant_review", to: "approved", outcome: "A", permission: "approve", actionForm: null },
  ],
  layout: {},
};

const defined = (result: WorkflowEditResult) => result.definition;

describe("adding a Step", () => {
  it("adds a Step to the Stage it is dropped into, keyed from its English name, at the drop point", () => {
    const { definition, key } = addStep(base, {
      name: t("Owner Representative approval", "اعتماد ممثل المالك"),
      stage: "pending_approval",
      actor: { role: "owner_representative", permission: "approve" },
      at: { x: 810, y: 420 },
    });
    expect(key).toBe("owner_representative_approval");
    expect(definition.steps.at(-1)).toEqual({
      key: "owner_representative_approval",
      name: t("Owner Representative approval", "اعتماد ممثل المالك"),
      stage: "pending_approval",
      actor: { role: "owner_representative", permission: "approve" },
      outcomeMode: "none",
    });
    expect(definition.layout.owner_representative_approval).toEqual({ x: 810, y: 420 });
    // The draft it came from is untouched: undo keeps it.
    expect(base.steps).toHaveLength(3);
  });

  it("gives a second Step of the same name its own key", () => {
    const once = defined(addStep(base, { name: t("New step", "خطوة جديدة"), stage: "pending_approval", actor: { role: "consultant", permission: "review" } }));
    const { key } = addStep(once, { name: t("New step", "خطوة جديدة"), stage: "pending_approval", actor: { role: "consultant", permission: "review" } });
    expect(key).toBe("new_step_2");
  });

  it("keys a Step whose English name has no Latin letters as a plain step", () => {
    const { key } = addStep(base, { name: t("", "خطوة"), stage: "pending_approval", actor: { role: "consultant", permission: "review" } });
    expect(key).toBe("step");
  });
});

describe("connecting two Steps", () => {
  const withOwner = defined(
    addStep(base, { name: t("Owner Representative approval", "اعتماد ممثل المالك"), stage: "pending_approval", actor: { role: "owner_representative", permission: "approve" } }),
  );

  it("adds a Submit between Steps of different roles, taken with the source Step's permission", () => {
    const { definition, key } = connectSteps(withOwner, "consultant_review", "owner_representative_approval", t("Send to Owner Rep", "إرسال لممثل المالك"));
    expect(key).toBe("send_to_owner_rep");
    expect(definition.transitions.at(-1)).toEqual({
      key: "send_to_owner_rep",
      label: t("Send to Owner Rep", "إرسال لممثل المالك"),
      kind: "submit",
      from: "consultant_review",
      to: "owner_representative_approval",
      outcome: null,
      permission: "approve",
      actionForm: null,
    });
  });

  it("adds a Send inside one role, and a Close into an outcome", () => {
    const twoConsultant = defined(addStep(withOwner, { name: t("Consultant QA", "تدقيق"), stage: "pending_approval", actor: { role: "consultant", permission: "review" } }));
    expect(connectSteps(twoConsultant, "consultant_review", "consultant_qa", t("Send to QA", "إرسال")).definition.transitions.at(-1)?.kind).toBe("send");
    expect(connectSteps(withOwner, "owner_representative_approval", "approved", t("Owner Approve", "اعتماد")).definition.transitions.at(-1)?.kind).toBe("close");
  });

  it("adds a Return when it runs back to an earlier Step of the same role", () => {
    const twoConsultant = defined(addStep(base, { name: t("Consultant QA", "تدقيق"), stage: "pending_approval", actor: { role: "consultant", permission: "review" } }));
    const sent = defined(connectSteps(twoConsultant, "consultant_review", "consultant_qa", t("Send to QA", "إرسال")));
    expect(connectSteps(sent, "consultant_qa", "consultant_review", t("Return", "إرجاع")).definition.transitions.at(-1)?.kind).toBe("return");
  });
});

describe("changing and removing", () => {
  it("changes a Step's names, actor rule and outcome mode, keeping its key", () => {
    const changed = updateStep(base, "consultant_review", {
      name: t("Consultant decision", "قرار الاستشاري"),
      actor: { role: "consultant", permission: "approve", positions: ["manager"] },
      outcomeMode: "recommend_code",
    });
    expect(changed.steps[1]).toEqual({
      key: "consultant_review",
      name: t("Consultant decision", "قرار الاستشاري"),
      stage: "pending_approval",
      actor: { role: "consultant", permission: "approve", positions: ["manager"] },
      outcomeMode: "recommend_code",
    });
  });

  it("changes a Transition's label, kind and outcome", () => {
    const changed = updateTransition(base, "approve_a", { label: t("Approve", "اعتماد"), outcome: "B" });
    expect(changed.transitions[1]).toMatchObject({ key: "approve_a", label: t("Approve", "اعتماد"), kind: "close", outcome: "B" });
  });

  it("removes a Step with every Transition into or out of it, and its place on the canvas", () => {
    const placed = { ...base, layout: { draft: { x: 0, y: 0 }, consultant_review: { x: 300, y: 0 }, approved: { x: 600, y: 0 } } };
    const removed = removeStep(placed, "consultant_review");
    expect(removed.steps.map((s) => s.key)).toEqual(["draft", "approved"]);
    expect(removed.transitions).toEqual([]);
    expect(removed.layout).toEqual({ draft: { x: 0, y: 0 }, approved: { x: 600, y: 0 } });
  });

  it("removes one Transition", () => {
    expect(removeTransition(base, "submit").transitions.map((tr) => tr.key)).toEqual(["approve_a"]);
  });

  it("moves a Step to another Stage where it is dropped", () => {
    const moved = moveStep(base, "consultant_review", { x: 320, y: 140 }, "internal_review");
    expect(moved.steps[1]?.stage).toBe("internal_review");
    expect(moved.layout.consultant_review).toEqual({ x: 320, y: 140 });
  });
});

describe("what changed since the published Version", () => {
  it("lists the Steps and Transitions added, removed and changed", () => {
    const withOwner = defined(
      addStep(base, { name: t("Owner Representative approval", "اعتماد ممثل المالك"), stage: "pending_approval", actor: { role: "owner_representative", permission: "approve" } }),
    );
    const draft = removeTransition(updateStep(withOwner, "draft", { name: t("Prepare", "إعداد") }), "approve_a");
    expect(definitionChanges(base, draft)).toEqual([
      { change: "added", kind: "step", key: "owner_representative_approval", name: t("Owner Representative approval", "اعتماد ممثل المالك") },
      { change: "removed", kind: "transition", key: "approve_a", name: t("Approve – Code A", "اعتماد – Code A") },
      { change: "changed", kind: "step", key: "draft", name: t("Prepare", "إعداد") },
    ]);
  });

  it("ignores Steps that only moved on the canvas", () => {
    expect(definitionChanges(base, moveStep(base, "draft", { x: 40, y: 40 }))).toEqual([]);
  });
});
