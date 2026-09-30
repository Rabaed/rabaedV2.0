// PostgreSQL errors the API turns into answers.

/** Raised by the app.* functions when the acting Member may not take the step. */
export const INSUFFICIENT_PRIVILEGE = "42501";

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
