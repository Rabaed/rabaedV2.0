// An Engineer's edit that the rules refuse (Option Lists, numbering): thrown
// inside the edit's transaction, so the edit rolls back and nothing is logged,
// then returned as the refusal's reason (RP-336).

export class Refused<R extends string> extends Error {
  constructor(readonly reason: R) {
    super(reason);
  }
}

/** An edit's result: its value, or why it was refused. */
export type Refusable<T, R extends string> = { ok: true; value: T } | { ok: false; reason: R };

/** Runs an edit; a `Refused`, or an error `refusalOf` names, becomes a refusal. Any other error is thrown. */
export async function refusable<T, R extends string>(
  run: () => Promise<T>,
  refusalOf?: (error: unknown) => R | undefined,
): Promise<Refusable<T, R>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason as R };
    const reason = refusalOf?.(error);
    if (reason) return { ok: false, reason };
    throw error;
  }
}

/** An outcome the database returned: the success word, or a refusal that rolls the edit back. */
export function expectOutcome<R extends string>(outcome: string, success: string, refusals: readonly R[]): void {
  if (outcome === success) return;
  if ((refusals as readonly string[]).includes(outcome)) throw new Refused(outcome as R);
  throw new Error(`unexpected outcome: ${outcome}`);
}
