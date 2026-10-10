import type { ListOutcomes } from "./work-item-list.tsx";

/**
 * One Type's outcome set (e.g. its outcomes read) as `Outcome` reads it: each
 * outcome tagged with the Type's code. Not a client module, so a server page
 * (the item page's Issued Code, RP-522) can call it.
 */
export function outcomesOfType<O extends Omit<ListOutcomes[number], "type">>(typeCode: string, outcomes: readonly O[]): ListOutcomes {
  return outcomes.map((o) => ({ ...o, type: typeCode }));
}
