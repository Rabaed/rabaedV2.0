import { z } from "zod";

/**
 * Download on an item that isn't closed (RP-621; visibility.md, the Working Copy row): its Working
 * Copy, the same PDF for every viewer. `ready` with a short-lived signed link to it; `preparing`
 * while the worker prints it (ask again); `failed` when it could not be printed; `closed` when the
 * item has closed since, so its download is the Documental Record.
 */
export const workingCopyAnswer = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), url: z.url(), expiresAt: z.iso.datetime() }),
  z.object({ status: z.literal("preparing") }),
  z.object({ status: z.literal("failed") }),
  z.object({ status: z.literal("closed") }),
]);
export type WorkingCopyAnswer = z.infer<typeof workingCopyAnswer>;
