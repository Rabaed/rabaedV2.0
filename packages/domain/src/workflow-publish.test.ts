import { describe, expect, it } from "vitest";
import { workflowKindProblems, type PublishedStep, type PublishedTransition } from "./workflow-publish.ts";

// Seam 3: publish checks 4 and 8 (workflow-engine.md §1; ADR 0014; RP-334). A
// Return stays inside one Participant role, a Submit crosses to another, and a
// Send Back goes from a Step of the role the item was Submitted to back to a Step
// of the role that Submitted it, with no outcome. A loop across Participants
// goes only through a Send Back.

// The Rabaed Default MAR's shape: the Contractor's Draft and review, the
// Consultant's review and approval, and the closed Steps (no role).
const steps: PublishedStep[] = [
  { key: "draft", role: "contractor" },
  { key: "internal_review", role: "contractor" },
  { key: "consultant_review", role: "consultant" },
  { key: "consultant_approval", role: "consultant" },
  { key: "oversight_review", role: "owner_representative" },
  { key: "approved", role: null },
  { key: "revise_resubmit", role: null },
];
const t = (key: string, from: string, to: string, kind: PublishedTransition["kind"], outcome: string | null = null): PublishedTransition => ({
  key,
  from,
  to,
  kind,
  outcome,
});
const mar: PublishedTransition[] = [
  t("send_for_review", "draft", "internal_review", "send"),
  t("return", "internal_review", "draft", "return"),
  t("submit", "internal_review", "consultant_review", "submit"),
  t("send_to_manager", "consultant_review", "consultant_approval", "send"),
  t("return_to_engineer", "consultant_approval", "consultant_review", "return"),
  t("approve_a", "consultant_approval", "approved", "close", "A"),
  t("revise_c", "consultant_approval", "revise_resubmit", "close", "C"),
];

describe("workflowKindProblems", () => {
  it("passes the MAR: Returns inside one role, the Submit across, no loop through Submit", () => {
    expect(workflowKindProblems(steps, mar)).toEqual([]);
  });

  it("passes a Send Back from the Consultant's Step to a Step of the Contractor, which Submitted it", () => {
    expect(workflowKindProblems(steps, [...mar, t("send_back", "consultant_review", "internal_review", "send_back")])).toEqual([]);
    expect(workflowKindProblems(steps, [...mar, t("send_back", "consultant_approval", "draft", "send_back")])).toEqual([]);
  });

  it("refuses a Return that crosses Participants, which also makes a loop across them", () => {
    expect(workflowKindProblems(steps, [...mar, t("return_to_contractor", "consultant_review", "internal_review", "return")])).toEqual([
      { transition: "submit", code: "loop_across_participants" },
      { transition: "return_to_contractor", code: "return_crosses_participants" },
      { transition: "return_to_contractor", code: "loop_across_participants" },
    ]);
  });

  it("refuses a Send Back aimed anywhere but the role that Submitted the item", () => {
    const aimed = (to: string, from = "consultant_review") =>
      workflowKindProblems(steps, [...mar, t("send_back", from, to, "send_back")]).map((p) => p.code);
    // Inside the Consultant: that is a Return.
    expect(aimed("consultant_review", "consultant_approval")).toEqual(["send_back_not_to_submitter"]);
    // To a role the Consultant never received the item from.
    expect(aimed("oversight_review")).toEqual(["send_back_not_to_submitter"]);
    // From the Contractor, which nobody Submitted to.
    expect(aimed("draft", "internal_review")).toEqual(["send_back_not_to_submitter"]);
    // To a closed Step: it would close the item.
    expect(aimed("revise_resubmit")).toEqual(["send_back_not_to_submitter"]);
  });

  it("refuses a Send Back that sets an outcome", () => {
    expect(workflowKindProblems(steps, [...mar, t("send_back", "consultant_review", "internal_review", "send_back", "C")])).toEqual([
      { transition: "send_back", code: "send_back_sets_outcome" },
    ]);
  });

  it("refuses a Submit that stays inside one role", () => {
    expect(workflowKindProblems(steps, [...mar, t("submit_again", "consultant_review", "consultant_approval", "submit")])).toEqual([
      { transition: "submit_again", code: "submit_stays_inside" },
    ]);
  });

  it("refuses a loop across Participants through Submit alone", () => {
    const problems = workflowKindProblems(steps, [...mar, t("submit_back", "consultant_review", "internal_review", "submit")]);
    expect(problems).toEqual([
      { transition: "submit", code: "cycle_without_return" },
      { transition: "submit", code: "loop_across_participants" },
      { transition: "submit_back", code: "cycle_without_return" },
      { transition: "submit_back", code: "loop_across_participants" },
    ]);
  });

  it("refuses a loop across Participants closed by a Return", () => {
    // Consultant Submits on to the Owner Representative, who Submits back to the
    // Consultant's approval; the Consultant's Return then closes the loop.
    const problems = workflowKindProblems(steps, [
      ...mar,
      t("to_oversight", "consultant_review", "oversight_review", "submit"),
      t("from_oversight", "oversight_review", "consultant_approval", "submit"),
    ]);
    expect(problems).toEqual([
      { transition: "to_oversight", code: "loop_across_participants" },
      { transition: "from_oversight", code: "loop_across_participants" },
    ]);
  });

  it("refuses a cycle inside one role without a Return", () => {
    expect(workflowKindProblems(steps, [...mar, t("back_to_draft", "internal_review", "draft", "send")])).toEqual([
      { transition: "send_for_review", code: "cycle_without_return" },
      { transition: "back_to_draft", code: "cycle_without_return" },
    ]);
  });
});
