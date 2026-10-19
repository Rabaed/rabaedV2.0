/** A command's refusals as a page says them, by the API's error code; `unavailable` for any other. */
export type Refusals = Record<string, string> & { unavailable: string };

/** Refusal `reason` as `refusals` say it: an error code the page doesn't know reads as `unavailable`, never as its code. */
export const sayRefusal = (refusals: Refusals, reason: string): string => refusals[reason] ?? refusals.unavailable;
