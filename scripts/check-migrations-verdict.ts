// `pnpm check:migrations` ends with one verdict line (RP-990): its refusals print
// in the middle and a passing line used to come last, so `| tail -1` showed a
// shared timestamp (RP-645's 20270803) as a pass. The line counts each kind of refusal.

/** How many of each kind of refusal the checks found. */
export interface Refusals {
  redefinedOnMain: number;
  redefinedUnseen: number;
  staleOverloads: number;
  sharedTimestamps: number;
  hiddenSortKeys: number;
  existingChanged: number;
  sortBeforeMain: number;
  otherIssueDays: number;
}

export const noRefusals: Refusals = { redefinedOnMain: 0, redefinedUnseen: 0, staleOverloads: 0, sharedTimestamps: 0, hiddenSortKeys: 0, existingChanged: 0, sortBeforeMain: 0, otherIssueDays: 0 };

/** Each kind's words for one and for more, in the order the checks run. */
const kinds: [keyof Refusals, string, string][] = [
  ["redefinedOnMain", "redefined on main too", "redefined on main too"],
  ["redefinedUnseen", "redefined unseen on this branch", "redefined unseen on this branch"],
  ["staleOverloads", "stale overload", "stale overloads"],
  ["sharedTimestamps", "shared timestamp", "shared timestamps"],
  ["hiddenSortKeys", "hidden sort key", "hidden sort keys"],
  ["existingChanged", "already on main and changed", "already on main and changed"],
  ["sortBeforeMain", "sorts before main", "sort before main"],
  ["otherIssueDays", "on another issue's day", "on another issue's day"],
];

/** The last line: `check:migrations: passed`, or `FAILED (...)` with each kind found and its count; a day nobody reserved is a warning only. */
export function verdictLine(refusals: Refusals, unreserved: number): string {
  const found = kinds.filter(([kind]) => refusals[kind] > 0).map(([kind, one, more]) => `${refusals[kind]} ${refusals[kind] === 1 ? one : more}`);
  const warning = unreserved > 0 ? `warning: ${unreserved} on a day nobody reserved` : "";
  if (found.length === 0) return `check:migrations: passed${warning ? ` (${warning})` : ""}`;
  return `check:migrations: FAILED (${found.join(", ")}${warning ? `; ${warning}` : ""})`;
}
