import { describe, expect, it } from "vitest";
import { closedStepKey, holderRole } from "./work-item-workflow.ts";
import type { WorkflowDefinition, WorkflowStep, WorkflowTransition } from "./workflow-definition.ts";

const name = (en: string) => ({ en, ar: en });
const step = (key: string, stage: string, role: "contractor" | "consultant" | null): WorkflowStep => ({
  key,
  name: name(key),
  stage,
  actor: role ? { role, permission: "review" } : null,
  outcomeMode: "none",
});
const transition = (key: string, from: string, to: string, kind: WorkflowTransition["kind"], outcome: string | null = null): WorkflowTransition => ({
  key,
  label: name(key),
  kind,
  from,
  to,
  outcome,
  permission: "approve",
  actionForm: null,
});

// Draft → Contractor review → Consultant engineer ⇄ manager → Approved (A, B) / Revise (C) / Cancelled.
const mar: WorkflowDefinition = {
  steps: [
    step("draft", "draft", "contractor"),
    step("internal_review", "internal_review", "contractor"),
    step("consultant_engineer", "pending_approval", "consultant"),
    step("consultant_manager", "pending_approval", "consultant"),
    step("approved", "approved", null),
    step("revise", "revise_resubmit", null),
    step("cancelled", "cancelled", null),
  ],
  transitions: [
    transition("send", "draft", "internal_review", "send"),
    transition("submit", "internal_review", "consultant_engineer", "submit"),
    transition("to_manager", "consultant_engineer", "consultant_manager", "send"),
    transition("approve_a", "consultant_manager", "approved", "close", "A"),
    transition("approve_b", "consultant_manager", "approved", "close", "B"),
    transition("revise_c", "consultant_manager", "revise", "close", "C"),
    transition("cancel", "draft", "cancelled", "cancel"),
  ],
  layout: {},
};

describe("closedStepKey", () => {
  it("is the terminal Step every close setting the item's outcome reaches", () => {
    expect(closedStepKey(mar, "A")).toBe("approved");
    expect(closedStepKey(mar, "B")).toBe("approved");
    expect(closedStepKey(mar, "C")).toBe("revise");
  });

  it("is the Cancel's Step for a cancelled item", () => {
    expect(closedStepKey(mar, "cancelled")).toBe("cancelled");
  });

  it("is null when the outcome reaches two terminal Steps, or none", () => {
    const split = { ...mar, steps: [...mar.steps, step("approved_2", "approved", null)], transitions: [...mar.transitions, transition("a2", "consultant_engineer", "approved_2", "close", "A")] };
    expect(closedStepKey(split, "A")).toBeNull();
    expect(closedStepKey(mar, "D")).toBeNull();
  });
});

describe("holderRole", () => {
  it("is the Participant role of the Step the item arrived at, not where it is now", () => {
    expect(holderRole(mar, "consultant_engineer")).toBe("consultant");
  });

  it("is null for a terminal or unknown Step", () => {
    expect(holderRole(mar, "approved")).toBeNull();
    expect(holderRole(mar, "nope")).toBeNull();
  });
});
