import { appVersion } from "@rabaed/domain";
import { z } from "zod";

export interface AdminConfig {
  /** Send cookies over HTTPS only. True everywhere except local http. */
  cookieSecure: boolean;
  /** The deployed commit, reported by /health; `local` in development. */
  version: string;
  /** The customer web's address: invitation links open there. */
  webUrl: string;
  invitationTtlMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How Rabaed Admin's sign-in protects itself (ADR 0010). Fixed, not configuration. */
export const signInPolicy = {
  /** An emailed code works this long. */
  codeTtlMs: 10 * MINUTE,
  /** At most this many codes per Engineer in `codeWindowMs`. */
  codesPerWindow: 3,
  codeWindowMs: 15 * MINUTE,
  /** A pending sign-in is given up after this many wrong codes. */
  wrongCodesPerChallenge: 3,
  /** Consecutive failed passwords or codes that lock an Engineer out, and for how long. */
  failuresBeforeLockout: 5,
  lockoutMs: 15 * MINUTE,
  /** A session ends after this long without a request, */
  idleMs: 30 * MINUTE,
  /** and after this long in any case. */
  sessionMaxMs: 12 * HOUR,
} as const;

export function adminConfigFromEnv(source: NodeJS.ProcessEnv = process.env): AdminConfig {
  const env = z
    .object({
      SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
      APP_VERSION: appVersion.default("local"),
      WEB_URL: z.url({ protocol: /^https?$/ }),
      INVITATION_TTL_HOURS: z.coerce.number().positive().default(72),
    })
    .parse(source);
  return {
    cookieSecure: env.SESSION_COOKIE_SECURE === "true",
    version: env.APP_VERSION,
    webUrl: env.WEB_URL.replace(/\/+$/, ""),
    invitationTtlMs: env.INVITATION_TTL_HOURS * HOUR,
  };
}
