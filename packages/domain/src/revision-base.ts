import { z } from "zod";

// Its own file, zod only: work-item.ts and handover.ts, which import each other's parts, both read it.

/**
 * Where a Revision stands before its own first Submit (RP-1314, owner's decision 2026-11-20): still a Draft, or in
 * Internal Review once it has left Draft. A Return never makes it a Draft again (GLOSSARY › Draft), so this is
 * "never left Draft", not its Stage.
 */
export const revisionBaseState = z.enum(["draft", "internal_review"]);
export type RevisionBaseState = z.infer<typeof revisionBaseState>;

/**
 * A Revision not yet Submitted as every screen names it (RP-1300, RP-1314): its chain's base Document Number, its
 * revision and where it stands, "UAT01-MAR-01-0005 Rev 1 · Internal Review". Read through app.revision_chain, so only
 * for a reader who sees the Revision and the chain's original (V1). Left out for every other item.
 */
export const revisionBase = z.object({
  baseNumber: z.string(),
  revisionNo: z.number().int().positive(),
  state: revisionBaseState,
});
export type RevisionBase = z.infer<typeof revisionBase>;
