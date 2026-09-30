// PostgreSQL errors the API turns into answers.

/** Raised by the app.* functions when the acting Member may not take the step. */
export const INSUFFICIENT_PRIVILEGE = "42501";
export const UNIQUE_VIOLATION = "23505";

export function pgError(error: unknown): { code?: string; constraint?: string } {
  return error as { code?: string; constraint?: string };
}

/** The acting Member may not take the step. */
export type Forbidden = { ok: false; reason: "forbidden" };

/** Runs `fn`; the database refusing the acting Member (42501) becomes `{ ok: false, reason: "forbidden" }`. */
export async function refusedAsForbidden<T>(fn: () => Promise<T>): Promise<T | Forbidden> {
  try {
    return await fn();
  } catch (error) {
    if (pgError(error).code === INSUFFICIENT_PRIVILEGE) return { ok: false, reason: "forbidden" };
    throw error;
  }
}

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
