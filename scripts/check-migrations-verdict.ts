// `pnpm check:migrations` ends with one verdict line (RP-990): its refusals print
// in the middle and a passing line used to come last, so `| tail -1` showed a
// shared timestamp (RP-645's 20270803) as a pass. The line counts each kind of refusal.

/** Each kind of refusal with its words for one and for more, in the order the checks run. */
const kinds = [
  ["redefinedOnMain", "redefined on main too", "redefined on main too"],
  ["redefinedUnseen", "redefined unseen on this branch", "redefined unseen on this branch"],
  ["staleOverloads", "stale overload", "stale overloads"],
  ["sharedTimestamps", "shared timestamp", "shared timestamps"],
  ["hiddenSortKeys", "hidden sort key", "hidden sort keys"],
  ["existingChanged", "already on main and changed", "already on main and changed"],
  ["sortBeforeMain", "sorts before main", "sort before main"],
  ["otherIssueDays", "on another issue's day", "on another issue's day"],
] as const;

/** How many of each kind of refusal the checks found. */
export type Refusals = Record<(typeof kinds)[number][0], number>;

export const noRefusals: Readonly<Refusals> = Object.freeze(Object.fromEntries(kinds.map(([kind]) => [kind, 0])) as Refusals);

/**
 * The last line: `check:migrations: passed`, or `FAILED (...)` with each check that
 * could not run (`stopped`) and each kind found with its count; a day nobody
 * reserved is a warning only.
 */
export function verdictLine(refusals: Refusals, unreserved: number, stopped: string[] = []): string {
  const found = kinds.filter(([kind]) => refusals[kind] > 0).map(([kind, one, more]) => `${refusals[kind]} ${refusals[kind] === 1 ? one : more}`);
  const reasons = [...stopped, ...found];
  const warning = unreserved > 0 ? `warning: ${unreserved} on a day nobody reserved` : "";
  if (reasons.length === 0) return `check:migrations: passed${warning ? ` (${warning})` : ""}`;
  return `check:migrations: FAILED (${reasons.join(", ")}${warning ? `; ${warning}` : ""})`;
}
