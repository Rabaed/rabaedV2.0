import { describe, expect, it } from "vitest";
import { defaultOutcomeSets } from "./outcome.ts";
import { workflowPublishProblems, type WorkflowPublishContext } from "./workflow-checks.ts";
import {
  definitionFromRows,
  definitionToRows,
  parseWorkflowDefinition,
  type ActorRule,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowTransition,
} from "./workflow-definition.ts";

// Pure domain (RP-625, SNAG-3; workflow-engine.md §1, §5.1): a Submit may name roles to inform.
// The format reads it, the rows keep it in the Transition's `actions` (no column of its own),
// and the publish checks accept it on a Submit only.

const t = (en: string) => ({ en, ar: en });

const context: WorkflowPublishContext = {
  outcomes: defaultOutcomeSets.none,
  stages: [
    { key: "draft", category: "draft" },
    { key: "open", category: "in_progress" },
    { key: "in_progress", category: "in_progress" },
    { key: "resolved", category: "in_progress" },
    { key: "closed", category: "closed_positive" },
  ],
  form: null,
};

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

/** The Snag's Version 3: as Version 2, and its Raise informs the Consultant. */
const snag: WorkflowDefinition = {
  steps: [
    step("draft", "draft", { raiser: true, permission: "create" }),
    step("open", "open", { role: "contractor", permission: "submit" }),
    step("in_progress", "in_progress", { role: "contractor", permission: "submit" }),
    step("verify", "resolved", { raiser: true, permission: "close" }),
    step("closed", "closed", null),
  ],
  transitions: [
    move("raise", "submit", "draft", "open", { permission: "create", inform: ["consultant"] }),
    move("start_work", "send", "open", "in_progress"),
    move("resolve", "submit", "in_progress", "verify"),
    move("return_to_open", "send_back", "verify", "open", { permission: "close" }),
    move("close", "close", "verify", "closed", { permission: "close", outcome: "closed" }),
  ],
  layout: {},
};

const withTransitions = (transitions: WorkflowTransition[]): WorkflowDefinition => ({ ...snag, transitions });
const codes = (d: WorkflowDefinition) => workflowPublishProblems(d, context).map((p) => p.code);

describe("the format: a Transition's roles to inform", () => {
  it("reads roles to inform", () => {
    const parsed = parseWorkflowDefinition(snag);
    expect(parsed.ok && parsed.definition.transitions[0]?.inform).toEqual(["consultant"]);
  });

  it("refuses an empty list, a role named twice and a role that isn't one", () => {
    for (const inform of [[], ["consultant", "consultant"], ["engineer"]]) {
      const raise = { ...snag.transitions[0], inform };
      expect(parseWorkflowDefinition(withTransitions([raise as WorkflowTransition, ...snag.transitions.slice(1)])).ok).toBe(false);
    }
  });
});

describe("the rows: inform is kept in the Transition's actions", () => {
  it("is stored as an inform entry of `actions`, after the Transition's own actions, and read back as `inform`", () => {
    const raise = { ...snag.transitions[0]!, actions: [{ type: "offer_assign_to" as const }] };
    const definition = withTransitions([raise, ...snag.transitions.slice(1)]);
    const rows = definitionToRows(definition, "none");
    expect(rows.transitions[0]?.actions).toEqual([{ type: "offer_assign_to" }, { type: "inform", roles: ["consultant"] }]);
    expect(definitionFromRows(rows)).toEqual(definition);
  });

  it("gives a Transition that only informs no actions of its own", () => {
    const rows = definitionToRows(snag, "none");
    expect(rows.transitions[0]?.actions).toEqual([{ type: "inform", roles: ["consultant"] }]);
    const back = definitionFromRows(rows);
    expect(back.transitions[0]).not.toHaveProperty("actions");
    expect(back).toEqual(snag);
  });

  it("writes no actions for a Transition that informs nobody", () => {
    expect(definitionToRows(snag, "none").transitions[1]).not.toHaveProperty("actions");
  });
});

describe("the publish checks", () => {
  it("accept roles to inform on a Submit", () => {
    expect(codes(snag)).toEqual([]);
  });

  it("refuse them on any other kind of Transition", () => {
    const informs = (kind: WorkflowTransition["kind"], from: string, to: string) =>
      withTransitions(snag.transitions.map((x) => (x.key === "start_work" ? move("start_work", kind, from, to, { inform: ["owner"] }) : x)));
    const found = workflowPublishProblems(informs("send", "open", "in_progress"), context).filter((p) => p.code === "inform_not_on_submit");
    expect(found).toEqual([expect.objectContaining({ severity: "error", transition: "start_work" })]);
    expect(found[0]?.message.en).toContain("start_work");
  });
});
