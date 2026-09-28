import { z } from "zod";

export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["ok", "unavailable"]),
});
export type HealthResponse = z.infer<typeof healthResponse>;
