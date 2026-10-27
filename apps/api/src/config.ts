import { appVersion, contentType, defaultDocumentContentTypes, defaultDocumentMaxBytes } from "@rabaed/domain";
import { z } from "zod";

export interface ApiConfig {
  sessionTtlMs: number;
  invitationTtlMs: number;
  /** The customer web (WEB_URL), which invitation emails link to; without it, inviting a Member fails. */
  webUrl?: string;
  /** Send the session cookie over HTTPS only. True everywhere except local http. */
  cookieSecure: boolean;
  /** The deployed commit, reported by /health; `local` in development. */
  version: string;
  /** What a Document may be: its largest size, and its file types. */
  documents: { maxBytes: number; contentTypes: string[] };
}

const HOUR = 3_600_000;
const MB = 1024 * 1024;

export function apiConfigFromEnv(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const env = z
    .object({
      SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
      INVITATION_TTL_HOURS: z.coerce.number().positive().default(72),
      WEB_URL: z.url().optional(),
      SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
      APP_VERSION: appVersion.default("local"),
      DOCUMENT_MAX_MB: z.coerce.number().positive().optional(),
      // Comma-separated media types, e.g. `application/pdf,image/png`.
      DOCUMENT_CONTENT_TYPES: z
        .string()
        .transform((list) => list.split(",").filter((t) => t.trim()))
        .pipe(z.array(contentType).min(1))
        .optional(),
    })
    .parse(source);
  return {
    sessionTtlMs: env.SESSION_TTL_HOURS * HOUR,
    invitationTtlMs: env.INVITATION_TTL_HOURS * HOUR,
    ...(env.WEB_URL ? { webUrl: env.WEB_URL } : {}),
    cookieSecure: env.SESSION_COOKIE_SECURE === "true",
    version: env.APP_VERSION,
    documents: {
      maxBytes: env.DOCUMENT_MAX_MB ? Math.floor(env.DOCUMENT_MAX_MB * MB) : defaultDocumentMaxBytes,
      contentTypes: env.DOCUMENT_CONTENT_TYPES ?? [...defaultDocumentContentTypes],
    },
  };
}
