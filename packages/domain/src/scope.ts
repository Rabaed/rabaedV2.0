import { z } from "zod";
import { bilingualText } from "./company.ts";

/**
 * A Scope under one of the Project's Trades, or a Sub-scope under a Scope.
 * Not a Visibility Dimension: it never grants or restricts access.
 */
export const scope = z.object({
  id: z.uuid(),
  /** The Trade it is under. */
  tradeId: z.uuid(),
  /** Sub-scopes only: their Scope. */
  parentId: z.uuid().nullable(),
  name: bilingualText,
  /** A deactivated one stays on the Work Items that already use it; it isn't offered for new ones. */
  active: z.boolean(),
});
export type Scope = z.infer<typeof scope>;

/** Scopes and Sub-scopes, by Trade, each Scope before its Sub-scopes. */
export const scopes = z.object({ scopes: z.array(scope) });
export type Scopes = z.infer<typeof scopes>;

/** A Project Admin adds a Scope under a Trade, or a Sub-scope under `parentId` (a Scope of that Trade). */
export const addScopeRequest = z.object({
  tradeId: z.uuid(),
  parentId: z.uuid().nullable().default(null),
  name: bilingualText,
});
export type AddScopeRequest = z.infer<typeof addScopeRequest>;

/** A Project Admin renames a Scope or Sub-scope, deactivates or reactivates it, or both. */
export const updateScopeRequest = z
  .object({ name: bilingualText.optional(), active: z.boolean().optional() })
  .refine((r) => r.name !== undefined || r.active !== undefined, { message: "Nothing to change" });
export type UpdateScopeRequest = z.infer<typeof updateScopeRequest>;
