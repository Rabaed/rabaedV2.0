/* eslint-disable rabaed/no-avoid-terms -- GitHub's merge queue and the hidden marker (an HTML comment), by their own names, as in review-post.ts */
// The comment `pnpm queue` posts on a PR just before it enqueues the head (RP-1195 item 3). `pnpm queue` and the
// PR page's queue button act as the same gh login, so the queue entry alone cannot tell them apart; this marker
// can. The hand-action workflow looks for a marker on the entry's head. Built-ins only, so any script can import it.

/** The hidden marker for `sha`. */
export const pnpmQueueMarker = (sha: string): string => `<!-- pnpm-queue: ${sha} -->`;

/** The comment's whole body: the marker and one plain line. */
export const pnpmQueueComment = (sha: string): string => `${pnpmQueueMarker(sha)}\nQueued by \`pnpm queue\` at ${sha}.`;

/** True when `body` holds the marker for `sha` (not for another head). */
export const hasPnpmQueueMarker = (body: string, sha: string): boolean => body.includes(pnpmQueueMarker(sha));
