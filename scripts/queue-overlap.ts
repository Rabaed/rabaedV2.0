/* eslint-disable rabaed/no-avoid-terms -- `pnpm queue`'s own name */

import { resolve } from "node:path";
import { branchOverlaps } from "./check-claims.ts";

// `node scripts/queue-overlap.ts <commit>`: the open-PR overlap warning for <commit> (a PR's head), as `pnpm queue`
// prints it (RP-1191, scripts/pr-overlap.ts). `pnpm queue` runs it as a child, so its sync checks can wait on GitHub
// with a timeout. Prints nothing when no other open PR shares a file; a look that fails prints one warning line.
// It never exits non-zero for what it finds: the warning is for people, never a refusal.

if (import.meta.filename && resolve(process.argv[1] ?? "") === import.meta.filename) {
  const commit = process.argv[2];
  if (!commit) {
    console.error("Usage: node scripts/queue-overlap.ts <commit>");
    process.exit(2);
  }
  const warning = await branchOverlaps(process.cwd(), undefined, commit);
  if (warning) console.log(warning);
}
