import { backwardKinds, type TransitionKind } from "./work-item.ts";

// Publish checks 4 and 8 (workflow-engine.md §1; ADR 0014; RP-334). Workflow
// Versions are published as data by migration until the builder (part 5), so a
// seam test runs these on every published Version, like check 7.

/** A Step of a Workflow Version: its key and the Participant role its actor rule names (null for a closed Step). */
export type PublishedStep = { key: string; role: string | null };

/** A Transition of a Workflow Version, by its Steps' keys. */
export type PublishedTransition = { key: string; from: string; to: string; kind: TransitionKind; outcome: string | null };

export type WorkflowKindProblem = {
  transition: string;
  code:
    | "return_crosses_participants"
    | "submit_stays_inside"
    | "send_back_not_to_submitter"
    | "send_back_sets_outcome"
    | "cycle_without_way_back"
    | "loop_across_participants";
};

/**
 * What stops a Workflow Version's Transitions from being published, by checks 4
 * and 8, Transition by Transition in the order given:
 * - a `return` goes to a Step of the same role (`return_crosses_participants`);
 * - a `submit` goes to a Step of another role (`submit_stays_inside`);
 * - a `send_back` goes from a Step of a role some `submit` hands the item to,
 *   back to a Step of a role that `submit` comes from (`send_back_not_to_submitter`),
 *   and sets no outcome (`send_back_sets_outcome`);
 * - no cycle goes without a `return` or a `send_back` (`cycle_without_way_back`), and
 *   none crosses roles without a `send_back` (`loop_across_participants`, on each
 *   Transition crossing roles inside such a loop).
 * Empty when there is nothing.
 */
export function workflowKindProblems(steps: readonly PublishedStep[], transitions: readonly PublishedTransition[]): WorkflowKindProblem[] {
  const role = new Map(steps.map((s) => [s.key, s.role]));
  const roleOf = (key: string) => role.get(key) ?? null;
  // The roles each role receives the item from by a Submit.
  const submittedFrom = new Map<string, Set<string>>();
  for (const tr of transitions) {
    const [from, to] = [roleOf(tr.from), roleOf(tr.to)];
    if (tr.kind !== "submit" || from === null || to === null || from === to) continue;
    submittedFrom.set(to, (submittedFrom.get(to) ?? new Set()).add(from));
  }
  const forward = transitions.filter((tr) => !backwardKinds.includes(tr.kind));
  const withReturns = transitions.filter((tr) => tr.kind !== "send_back");

  return transitions.flatMap((tr): WorkflowKindProblem[] => {
    const [from, to] = [roleOf(tr.from), roleOf(tr.to)];
    const problems: WorkflowKindProblem["code"][] = [];
    if (tr.kind === "return" && (from === null || from !== to)) problems.push("return_crosses_participants");
    if (tr.kind === "submit" && from !== null && from === to) problems.push("submit_stays_inside");
    if (tr.kind === "send_back") {
      if (from === null || to === null || !submittedFrom.get(from)?.has(to)) problems.push("send_back_not_to_submitter");
      if (tr.outcome !== null) problems.push("send_back_sets_outcome");
    }
    if (forward.includes(tr) && reaches(forward, tr.to, tr.from)) problems.push("cycle_without_way_back");
    if (withReturns.includes(tr) && from !== to && reaches(withReturns, tr.to, tr.from)) problems.push("loop_across_participants");
    return problems.map((code) => ({ transition: tr.key, code }));
  });
}

/** Whether Step `target` can be reached from Step `start` along `edges` (a Step reaches itself). */
function reaches(edges: readonly PublishedTransition[], start: string, target: string): boolean {
  const seen = new Set([start]);
  const queue = [start];
  for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
    if (step === target) return true;
    for (const e of edges) {
      if (e.from === step && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return false;
}
