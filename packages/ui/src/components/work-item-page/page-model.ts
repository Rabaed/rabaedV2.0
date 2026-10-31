import type { BilingualText } from "@rabaed/domain";
import type { SubmittalTimelineEvent } from "../submittal-panel/timeline-model.ts";

/**
 * Small reads the Work Item page draws from (RP-1151), worked out apart from React so they are
 * tested on their own. They read only what the item, history and Workflow map reads already give
 * the viewer: nothing here puts back what those hide.
 */

export type WorkItemCodeResult = {
  code: string;
  /** When it was issued (ISO). */
  at: string;
  /** The shared Remarks written with it; null when none were. */
  remarks: string | null;
  /** Who signed it: the one person of another Company the live item names (V14), by name only. */
  signer: BilingualText | null;
  company: BilingualText | null;
};

/**
 * The result card after a Code (gap table row 23): the Code the item closed with (`outcome`), from
 * its latest shared `issue_code` event. Never a Recommended Code (V5), and none while the item is
 * open or for a Cancel, which issues no Code.
 */
export function workItemCodeResult(events: readonly SubmittalTimelineEvent[], outcome: string | null): WorkItemCodeResult | null {
  if (outcome === null) return null;
  const issued = events.findLast((e) => e.type === "issue_code" && e.audience === "shared" && e.outcome === outcome);
  if (!issued) return null;
  return {
    code: outcome,
    at: issued.at,
    remarks: issued.remarks?.trim() ? issued.remarks : null,
    signer: issued.by.memberName,
    company: issued.by.companyName,
  };
}

/**
 * The Review Code each offered Transition issues, by its key (gap table row 27): the outcome its
 * Workflow's close Transition of that key sets. A Transition that sets none has no code; so does
 * every one while the Workflow map isn't read.
 */
export function transitionCodes(
  offered: readonly { key: string }[],
  definition: { transitions: readonly { key: string; kind: string; outcome?: string | null }[] } | null,
): Record<string, string> {
  if (!definition) return {};
  const byKey = new Map(definition.transitions.map((t) => [t.key, t]));
  return Object.fromEntries(
    offered.flatMap((t) => {
      const defined = byKey.get(t.key);
      return defined?.kind === "close" && defined.outcome ? [[t.key, defined.outcome]] : [];
    }),
  );
}
