import { z } from "zod";

/**
 * Whether the signed-in Member watches a Work Item (GLOSSARY "Watch"): their own
 * Watch only. No read ever says who else watches an item, nor how many do
 * (visibility.md, the Watch row).
 */
export const watchState = z.object({ watching: z.boolean() });
export type WatchState = z.infer<typeof watchState>;
