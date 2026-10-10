import { describe, expect, it } from "vitest";
import {
  definitionFromRows,
  definitionToRows,
  parseWorkflowDefinition,
  storedTransitionRules,
  type WorkflowDefinition,
} from "./workflow-definition.ts";
import { marRows } from "../test/support/mar-workflow.ts";

// Pure domain: the Workflow definition format (workflow-engine.md §1, §11; RP-425,
// spec RP-423). One JSON document per Workflow Version, read from and written to
// the Version's rows.

describe("the Workflow definition format", () => {
  it("reads MAR Version 1's rows as Steps with their Stage and actor rule, and Transitions between them", () => {
    const definition = definitionFromRows(marRows(1));
    expect(definition.steps[0]).toEqual({
      key: "draft",
      name: { en: "Draft", ar: "مسودة" },
      stage: "draft",
      actor: { role: "contractor", permission: "create" },
      outcomeMode: "none",
    });
    expect(definition.steps.find((s) => s.key === "consultant_review")?.outcomeMode).toBe("issue_outcome");
    expect(definition.steps.find((s) => s.key === "approved")?.actor).toBeNull();
    expect(definition.transitions.map((t) => [t.key, t.from, t.to, t.kind, t.outcome])).toEqual([
      ["send_for_review", "draft", "internal_review", "send", null],
      ["return", "internal_review", "draft", "return", null],
      ["submit", "internal_review", "consultant_review", "submit", null],
      ["approve_a", "consultant_review", "approved", "close", "A"],
      ["revise_c", "consultant_review", "revise_resubmit", "close", "C"],
    ]);
    expect(definition.layout).toEqual({});
  });

  it.each([1, 2] as const)("round-trips MAR Version %i's rows without loss", (version) => {
    expect(definitionToRows(definitionFromRows(marRows(version)), "review_code")).toEqual(marRows(version));
  });

  it("writes an issuing Step as an Inspection Result Step for a Type with Inspection Results", () => {
    const rows = definitionToRows(definitionFromRows(marRows(1)), "inspection_result");
    expect(rows.steps.find((s) => s.key === "consultant_review")?.outcome_mode).toBe("inspection_result");
    expect(definitionFromRows(rows)).toEqual(definitionFromRows(marRows(1)));
  });

  it("keeps rules, actions, notifications, Positions and the layout through the rows", () => {
    const definition: WorkflowDefinition = {
      ...definitionFromRows(marRows(2)),
      layout: { draft: { x: 0, y: 0 }, internal_review: { x: 240, y: 0 } },
    };
    definition.steps[1] = { ...definition.steps[1]!, actor: { role: "contractor", permission: "review", positions: ["project_manager"] } };
    definition.transitions[2] = {
      ...definition.transitions[2]!,
      rules: {
        restrict: [
          { type: "condition", condition: { field: "cost_impact", op: ">", value: 500000 } },
          { type: "been_through", step: "internal_review" },
          { type: "been_through", fact: "sent_back" },
          { type: "not_same_person", transition: "send_for_review" },
          { type: "not_same_person", step: "draft" },
        ],
        validate: [{ type: "form_complete" }, { type: "has_document" }, { type: "has_document", field: "datasheet" }],
      },
      actions: [
        { type: "offer_assign_to" },
        { type: "set_field", field: "submitted_on", value: { now: true } },
        { type: "set_field", field: "model", value: "now" },
      ],
      notifications: [{ to: "holder" }, { to: "raiser" }, { to: "watchers" }, { to: "position", position: "project_manager" }],
    };
    expect(definitionFromRows(definitionToRows(definition, "review_code"))).toEqual(definition);
  });

  it("keeps a Step's \"edits the Form\" and the Draft Step's \"Drafts visible to\" through the rows, only when set (RP-514)", () => {
    const definition = definitionFromRows(marRows(2));
    definition.steps[0] = { ...definition.steps[0]!, draftsVisibleTo: "author" };
    definition.steps[1] = { ...definition.steps[1]!, editsForm: true };
    const rows = definitionToRows(definition, "review_code");
    expect(rows.steps[0]).toMatchObject({ drafts_visible_to: "author" });
    expect(rows.steps[1]).toMatchObject({ edits_form: true });
    expect(rows.steps[2]).not.toHaveProperty("edits_form");
    expect(rows.steps[2]).not.toHaveProperty("drafts_visible_to");
    expect(definitionFromRows(rows)).toEqual(definition);
  });

  it("keeps the Screen a Transition shows through the rows, only when it names one (ADR 0019, RP-516)", () => {
    const definition = definitionFromRows(marRows(2));
    definition.transitions[3] = { ...definition.transitions[3]!, actionForm: null, screen: "code_reply" };
    const rows = definitionToRows(definition, "review_code");
    expect(rows.transitions[3]).toMatchObject({ screen_key: "code_reply", action_form: null });
    expect(rows.transitions[2]).not.toHaveProperty("screen_key");
    expect(definitionFromRows(rows)).toEqual(definition);
  });

  it("reads a published Transition's pinned Screen as the Screen alone: its Action Form is the Screen Version's copy", () => {
    const rows = definitionToRows(definitionFromRows(marRows(2)), "review_code");
    rows.transitions[3] = { ...rows.transitions[3]!, screen_key: "code_reply" };
    expect(definitionFromRows(rows).transitions[3]).toMatchObject({ screen: "code_reply", actionForm: null });
  });
});

describe("parseWorkflowDefinition", () => {
  const mar = () => JSON.parse(JSON.stringify(definitionFromRows(marRows(2)))) as Record<string, unknown>;

  it("accepts a definition as JSON", () => {
    expect(parseWorkflowDefinition(mar())).toEqual({ ok: true, definition: definitionFromRows(marRows(2)) });
  });

  it("refuses an unknown key, at any depth, naming where it is", () => {
    const top = { ...mar(), is_signing: true };
    expect(parseWorkflowDefinition(top)).toMatchObject({ ok: false, issues: [{ path: "" }] });
    const deep = mar();
    (deep.steps as Record<string, unknown>[])[0]!.isSigning = true;
    expect(parseWorkflowDefinition(deep)).toMatchObject({ ok: false, issues: [{ path: "steps.0" }] });
    const actor = mar();
    ((actor.steps as Record<string, unknown>[])[0]!.actor as Record<string, unknown>).holder = "ali";
    expect(parseWorkflowDefinition(actor)).toMatchObject({ ok: false, issues: [{ path: "steps.0.actor" }] });
  });

  it("has no way to name a person: Positions only, in actor rules, actions and notifications (ADR 0016)", () => {
    const member = "0192f6c5-3c2e-7c4a-9d4e-1a2b3c4d5e6f";
    const actor = mar();
    ((actor.steps as Record<string, unknown>[])[1]!.actor as Record<string, unknown>).member = member;
    expect(parseWorkflowDefinition(actor)).toMatchObject({ ok: false, issues: [{ path: "steps.1.actor" }] });
    const assign = mar();
    (assign.transitions as Record<string, unknown>[])[0]!.actions = [{ type: "assign_to", member }];
    expect(parseWorkflowDefinition(assign)).toMatchObject({ ok: false, issues: [{ path: "transitions.0.actions.0.type" }] });
    const notify = mar();
    (notify.transitions as Record<string, unknown>[])[0]!.notifications = [{ to: "member", member }];
    expect(parseWorkflowDefinition(notify)).toMatchObject({ ok: false, issues: [{ path: "transitions.0.notifications.0.to" }] });
  });

  it("refuses a rule naming both a Step and a Transition, a fact it doesn't know, and \"now\" as anything but its own value", () => {
    const withRestrict = (restrict: unknown[]) => {
      const d = mar();
      (d.transitions as Record<string, unknown>[])[2]!.rules = { restrict };
      return d;
    };
    expect(parseWorkflowDefinition(withRestrict([{ type: "not_same_person", step: "draft", transition: "submit" }]))).toMatchObject({ ok: false });
    expect(parseWorkflowDefinition(withRestrict([{ type: "been_through", fact: "returned" }]))).toMatchObject({ ok: false });
    const now = mar();
    (now.transitions as Record<string, unknown>[])[2]!.actions = [{ type: "set_field", field: "model", value: { now: false } }];
    expect(parseWorkflowDefinition(now)).toMatchObject({ ok: false });
  });

  it("takes a Screen by its key only", () => {
    const named = mar();
    (named.transitions as Record<string, unknown>[])[3]!.screen = "Code reply";
    expect(parseWorkflowDefinition(named)).toMatchObject({ ok: false, issues: [{ path: "transitions.3.screen" }] });
  });

  it("refuses an unknown Transition kind and an outcome mode the format doesn't have", () => {
    const kind = mar();
    (kind.transitions as Record<string, unknown>[])[0]!.kind = "approve";
    expect(parseWorkflowDefinition(kind)).toMatchObject({ ok: false, issues: [{ path: "transitions.0.kind" }] });
    const mode = mar();
    (mode.steps as Record<string, unknown>[])[2]!.outcomeMode = "issue_code";
    expect(parseWorkflowDefinition(mode)).toMatchObject({ ok: false, issues: [{ path: "steps.2.outcomeMode" }] });
  });

  it("needs English and Arabic for every Step name and Transition label", () => {
    const name = mar();
    (name.steps as Record<string, unknown>[])[0]!.name = { en: "Draft" };
    expect(parseWorkflowDefinition(name)).toMatchObject({ ok: false, issues: [{ path: "steps.0.name.ar" }] });
  });
});

describe("a Transition's stored rules", () => {
  it("read as none when the Transition has none, and as they are when they fit the format", () => {
    expect(storedTransitionRules(null)).toEqual({});
    expect(storedTransitionRules({ validate: [{ type: "form_complete" }] })).toEqual({ validate: [{ type: "form_complete" }] });
  });

  it("fail loudly when they no longer fit the format, never read as no rules", () => {
    expect(() => storedTransitionRules({ validate: [{ type: "no_such_rule" }] })).toThrow();
    expect(() => storedTransitionRules({ restrict: "not a list" })).toThrow();
  });
});
