import { z } from "zod";

export interface ApiConfig {
  sessionTtlMs: number;
  invitationTtlMs: number;
  /** Send the session cookie over HTTPS only. True everywhere except local http. */
  cookieSecure: boolean;
}

const HOUR = 3_600_000;

export function apiConfigFromEnv(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const env = z
    .object({
      SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
      INVITATION_TTL_HOURS: z.coerce.number().positive().default(72),
      SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
    })
    .parse(source);
  return {
    sessionTtlMs: env.SESSION_TTL_HOURS * HOUR,
    invitationTtlMs: env.INVITATION_TTL_HOURS * HOUR,
    cookieSecure: env.SESSION_COOKIE_SECURE === "true",
  };
}
