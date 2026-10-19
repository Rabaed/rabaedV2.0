// What opening a Transition shows (RP-85, RP-617; workflow-engine.md §5.1 check 6): no Signature,
// no Transition, then no Stamp, no Transition, both asked before the Action Form so no answers
// are lost. On the item page the item read answers both; on the Kanban the move asks
// GET /v1/me/signature and GET /v1/me/company when it opens.

/** A value read from the API: on its way, failed, or read. */
export type Reading<T> = { state: "loading" } | { state: "failed" } | { state: "loaded"; value: T };

export const loading = { state: "loading" } as const;
export const failed = { state: "failed" } as const;
export const loaded = <T>(value: T): Reading<T> => ({ state: "loaded", value });

/** `reading`'s value through `f`, once read. */
export function mapRead<T, U>(reading: Reading<T>, f: (value: T) => U): Reading<U> {
  return reading.state === "loaded" ? loaded(f(reading.value)) : reading;
}

export type TransitionGate<C> =
  | { show: "wait" }
  | { show: "unavailable" }
  | { show: "signature" }
  | { show: "stamp"; company: C }
  | { show: "actionForm" };

/**
 * What a Member opening a Transition gets: the Signature pop-up first, then the no-Stamp message
 * (naming their own `company`), else the Action Form. Nothing yet while what decides it is on its
 * way, and an error, never the Action Form, when it couldn't be read.
 */
export function transitionGate<C>({
  hasSignature,
  hasStamp,
  company,
}: {
  hasSignature: Reading<boolean>;
  hasStamp: Reading<boolean>;
  company: Reading<C>;
}): TransitionGate<C> {
  if (hasSignature.state !== "loaded") return { show: hasSignature.state === "loading" ? "wait" : "unavailable" };
  if (!hasSignature.value) return { show: "signature" };
  if (hasStamp.state !== "loaded") return { show: hasStamp.state === "loading" ? "wait" : "unavailable" };
  if (hasStamp.value) return { show: "actionForm" };
  if (company.state !== "loaded") return { show: company.state === "loading" ? "wait" : "unavailable" };
  return { show: "stamp", company: company.value };
}
