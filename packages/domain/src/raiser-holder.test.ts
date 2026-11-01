import { describe, expect, it } from "vitest";
import { editableAtProblem, sectionSteps, type WorkflowStepHolder } from "./form-sections.ts";
import { defaultOutcomeSets } from "./outcome.ts";
import { withRaiserRole } from "./work-item-workflow.ts";
import { stepEditsForm, workflowPublishProblems, type WorkflowPublishContext } from "./workflow-checks.ts";
import {
  actorHolder,
  actorRole,
  definitionFromRows,
  definitionToRows,
  parseWorkflowDefinition,
  type ActorRule,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowTransition,
} from "./workflow-definition.ts";

// Pure domain (RP-622, SNAG-2; workflow-engine.md §3.1): a Step's actor rule may name the
// raiser instead of a role. The format reads it, the rows keep it, and the publish and Form
// Section checks treat the raiser as its own holder: a Step held by the raiser is the
// raiser's own Step, whoever raises the item.

const t = (en: string) => ({ en, ar: en });

const snagStages: WorkflowPublishContext["stages"] = [
  { key: "draft", category: "draft" },
  { key: "open", category: "in_progress" },
  { key: "in_progress", category: "in_progress" },
  { key: "resolved", category: "in_progress" },
  { key: "closed", category: "closed_positive" },
  { key: "cancelled", category: "cancelled" },
];

const context: WorkflowPublishContext = { outcomes: defaultOutcomeSets.none, stages: snagStages, form: null };

const step = (key: string, stage: string, actor: ActorRule | null): WorkflowStep => ({ key, name: t(key), stage, actor, outcomeMode: "none" });
const move = (key: string, kind: WorkflowTransition["kind"], from: string, to: string, extra: Partial<WorkflowTransition> = {}): WorkflowTransition => ({
  key,
  label: t(key),
  kind,
  from,
  to,
  outcome: null,
  permission: "submit",
  actionForm: null,
  ...extra,
});

/** The Snag's Version 2: Draft and Verify held by the raiser, Open ⇄ In Progress at the Contractor. */
const snag: WorkflowDefinition = {
  steps: [
    step("draft", "draft", { raiser: true, permission: "create" }),
    step("open", "open", { role: "contractor", permission: "submit" }),
    step("in_progress", "in_progress", { role: "contractor", permission: "submit" }),
    step("verify", "resolved", { raiser: true, permission: "close" }),
    step("closed", "closed", null),
  ],
  transitions: [
    move("raise", "submit", "draft", "open", { permission: "create" }),
    move("start_work", "send", "open", "in_progress"),
    move("back_to_open", "return", "in_progress", "open"),
    move("resolve", "submit", "in_progress", "verify"),
    move("close", "close", "verify", "closed", { outcome: "closed", permission: "close" }),
    move("return_to_open", "send_back", "verify", "open", {
      permission: "close",
      actionForm: { sections: [{ key: "return", title: t("Return"), fields: [{ key: "reason", type: "textarea", required: true, label: t("Reason") }] }] },
    }),
  ],
  layout: {},
};

const codes = (definition: WorkflowDefinition) => workflowPublishProblems(definition, context).map((p) => p.code);
const withSteps = (map: (s: WorkflowStep) => WorkflowStep): WorkflowDefinition => ({ ...snag, steps: snag.steps.map(map) });
const withTransitions = (transitions: WorkflowTransition[]): WorkflowDefinition => ({ ...snag, transitions });

describe("an actor rule naming the raiser", () => {
  it("is read by the format, with its Function Permission and optional Positions", () => {
    const parsed = parseWorkflowDefinition(snag);
    expect(parsed.ok).toBe(true);
    const positioned = parseWorkflowDefinition(withSteps((s) => (s.key === "verify" ? { ...s, actor: { raiser: true, permission: "close", positions: ["engineer"] } } : s)));
    expect(parsed.ok && positioned.ok).toBe(true);
  });

  it.each([
    ["raiser false", { raiser: false, permission: "create" }],
    ["a role as well", { raiser: true, role: "contractor", permission: "create" }],
    ["no Function Permission", { raiser: true }],
    ["an unknown Function Permission", { raiser: true, permission: "decide" }],
    ["no Positions in its list", { raiser: true, permission: "create", positions: [] }],
    ["neither role nor raiser", { permission: "create" }],
  ])("is refused with %s", (_case, actor) => {
    const parsed = parseWorkflowDefinition({ ...snag, steps: [{ ...snag.steps[0], actor }, ...snag.steps.slice(1)] });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((i) => i.path).filter((p) => p.startsWith("steps.0.actor"))).not.toEqual([]);
  });

  it("is stored as it is in the rows, a role rule's role as base_role, and read back without loss", () => {
    const rows = definitionToRows(snag, "none");
    expect(rows.steps.find((s) => s.key === "draft")!.actor_rule).toEqual({ raiser: true, permission: "create" });
    expect(rows.steps.find((s) => s.key === "open")!.actor_rule).toEqual({ base_role: "contractor", permission: "submit" });
    expect(rows.steps.find((s) => s.key === "closed")!.actor_rule).toEqual({});
    expect(definitionFromRows(rows)).toEqual(snag);
  });

  it("names the raiser as its holder and no role; a role rule names its role for both", () => {
    expect(actorHolder({ raiser: true, permission: "close" })).toBe("raiser");
    expect(actorRole({ raiser: true, permission: "close" })).toBeNull();
    expect(actorHolder({ role: "consultant", permission: "close" })).toBe("consultant");
    expect(actorRole({ role: "consultant", permission: "close" })).toBe("consultant");
    expect(actorHolder(null)).toBeNull();
  });
});

describe("the publish checks with the raiser as a holder", () => {
  it("accept the Snag's Version 2: the raiser Submits to the Contractor, which Submits back, and the raiser Sends it Back", () => {
    expect(codes(snag)).toEqual([]);
  });

  it("refuse a Submit from the raiser to the raiser, and a Return or Send across the raiser and a role", () => {
    expect(codes(withTransitions([...snag.transitions, move("again", "submit", "verify", "draft")]))).toContain("submit_stays_inside");
    expect(codes(withTransitions([...snag.transitions, move("back", "return", "verify", "in_progress")]))).toContain("return_crosses_participants");
    expect(codes(withTransitions([...snag.transitions, move("hand", "send", "draft", "open")]))).toContain("send_crosses_participants");
  });

  it("refuse a Send Back from the raiser to a role that never Submitted to it", () => {
    const steps = [...snag.steps, step("owner_check", "open", { role: "owner", permission: "review" })];
    const transitions = [...snag.transitions, move("ask_owner", "submit", "draft", "owner_check"), move("owner_done", "submit", "owner_check", "verify")];
    expect(codes({ ...snag, steps, transitions })).toEqual([]);
    const back = move("to_owner", "send_back", "open", "owner_check", { permission: "submit" });
    expect(codes({ ...snag, steps, transitions: [...transitions, back] })).toContain("send_back_not_to_submitter");
  });

  it("let a Cancel leave a Step held by the raiser, as the Draft's holder, and no other", () => {
    const steps = [...snag.steps, step("cancelled", "cancelled", null)];
    const cancel = (from: string) => move(`cancel_${from}`, "cancel", from, "cancelled", { permission: "create" });
    expect(codes({ ...snag, steps, transitions: [...snag.transitions, cancel("draft")] })).toEqual([]);
    expect(codes({ ...snag, steps, transitions: [...snag.transitions, cancel("open")] })).toContain("cancel_not_by_raiser");
  });

  it("refuse a Step held by the raiser after a Submit that edits the raiser's Form, as one of the raiser's role would", () => {
    const edits = withSteps((s) => (s.key === "verify" ? { ...s, actor: { raiser: true, permission: "create" } } : s));
    expect(codes(edits)).toContain("form_edited_after_submit");
    // Verify holds `close`, not the Draft's `create`: it doesn't edit the raiser's Form.
    expect(stepEditsForm(snag, snag.steps[3]!, snagStages)).toBe(false);
    expect(stepEditsForm(snag, snag.steps[0]!, snagStages)).toBe(true);
  });
});

describe("Form Sections with the raiser as a holder", () => {
  const holders: WorkflowStepHolder[] = snag.steps.map((s) => ({ key: s.key, role: actorHolder(s.actor), draft: s.stage === "draft" }));

  it("are the raiser's at the Steps held by the raiser when they name none", () => {
    expect(sectionSteps({}, holders)).toEqual(["draft", "verify"]);
  });

  it("are filled by one Participant: the raiser's Steps together, but never with a role's", () => {
    expect(editableAtProblem({ editable_at: ["open", "in_progress"] }, holders)).toBeNull();
    expect(editableAtProblem({ editable_at: ["draft", "verify"] }, holders)).toBeNull();
    expect(editableAtProblem({ editable_at: ["open", "verify"] }, holders)).toBe("mixed_roles");
  });
});

describe("an item's map of a Workflow with the raiser as a holder", () => {
  it("holds the raiser's Steps by the item's raiser's role", () => {
    // The map's holder role for another Company now comes from app.step_as_seen's holder_role (RP-1192).
    const consultantRaised = withRaiserRole(snag, "consultant");
    expect(consultantRaised.steps[0]!.actor).toEqual({ role: "consultant", permission: "create" });
  });
});
