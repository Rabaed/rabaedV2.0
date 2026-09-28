// In AWS, Secrets Manager rotates the database passwords. api and worker run
// for weeks, so instead of a password fixed at start they read the current
// one from the secret whenever the pool opens a connection, briefly cached.
// Connections already open are unaffected by a rotation; a new one refused
// while the password is being switched rereads the secret and tries again.

export interface RotatingPassword {
  /** The current password, from the cache or freshly read. */
  get(): Promise<string>;
  /** Forget the cached password, e.g. after the database refused it. */
  invalidate(): void;
}

export function rotatingPassword(
  read: () => Promise<string>,
  { ttlMs = 5 * 60_000, now = Date.now }: { ttlMs?: number; now?: () => number } = {},
): RotatingPassword {
  let cached: { value: Promise<string>; at: number } | undefined;
  return {
    get() {
      if (!cached || now() - cached.at >= ttlMs) {
        const value = read();
        const entry = { value, at: now() };
        cached = entry;
        // Never cache a failed read.
        value.catch(() => {
          if (cached === entry) cached = undefined;
        });
      }
      return cached.value;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

/** Postgres's SQLSTATE for "password authentication failed". */
const INVALID_PASSWORD = "28P01";

/** Connects; if the password was refused, calls `onRefused` (to reread it) and tries once more. */
export async function connectWithRetry<T>(connect: () => Promise<T>, onRefused: () => void): Promise<T> {
  try {
    return await connect();
  } catch (error) {
    if ((error as { code?: string }).code !== INVALID_PASSWORD) throw error;
    onRefused();
    return connect();
  }
}
