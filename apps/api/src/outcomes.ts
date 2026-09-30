// The outcome words the app.* functions answer with, checked rather than cast.

/**
 * An app.* function's outcome word, checked against the ones the caller handles:
 * an SQL function that gained a word TypeScript doesn't know fails loudly here,
 * not later as an unknown refusal.
 */
export function checkedOutcome<const W extends string>(value: unknown, words: readonly W[]): W {
  if (typeof value === "string" && (words as readonly string[]).includes(value)) return value as W;
  throw new Error(`Unexpected outcome from the database: ${String(value)}`);
}

/** An app.* command's outcome as a result: `done` is its success word, one of `refusals` a refusal. */
export function commandResult<const R extends string>(
  value: unknown,
  done: string,
  refusals: readonly R[],
): { ok: true } | { ok: false; reason: R } {
  const outcome = checkedOutcome<string>(value, [done, ...refusals]);
  return outcome === done ? { ok: true } : { ok: false, reason: outcome as R };
}
