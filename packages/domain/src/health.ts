import { z } from "zod";

/** The commit a process was built from (APP_VERSION), or `local` in development. */
export const appVersion = z.string().min(1).max(64);

/** GET /health on the api. */
export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["ok", "unavailable"]),
  version: appVersion,
});
export type HealthResponse = z.infer<typeof healthResponse>;

/** GET /api/health on web: web's own version, and what the api reports (null if unreachable). */
export const webHealthResponse = z.object({
  status: z.literal("ok"),
  version: appVersion,
  api: healthResponse.nullable(),
});
export type WebHealthResponse = z.infer<typeof webHealthResponse>;
