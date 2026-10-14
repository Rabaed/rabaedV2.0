import { z } from "zod";
import { bilingualText } from "./company.ts";

/**
 * A supplier or manufacturer on a Project's Approved Supplier List (RP-592), for
 * one of its Trades. Every Participant reads it, never what put it there (V10).
 */
export const approvedSupplier = z.object({
  id: z.uuid(),
  name: bilingualText,
  /** The Trade it is approved for. */
  tradeId: z.uuid(),
  /** Optional: the Scope or Sub-scope of that Trade it is approved for. */
  scopeId: z.uuid().nullable(),
  /** A withdrawn one stays on the items that already chose it; it can't be chosen again. */
  status: z.enum(["approved", "withdrawn"]),
});
export type ApprovedSupplier = z.infer<typeof approvedSupplier>;

/** The Approved Supplier List, by Trade (as the Trades are listed), then by English name. */
export const approvedSuppliers = z.object({ suppliers: z.array(approvedSupplier) });
export type ApprovedSuppliers = z.infer<typeof approvedSuppliers>;

/** The list's filters: one Trade, one status, or both. */
export const approvedSuppliersQuery = z.object({
  tradeId: z.uuid().optional(),
  status: z.enum(["approved", "withdrawn"]).optional(),
});
export type ApprovedSuppliersQuery = z.infer<typeof approvedSuppliersQuery>;

/** A Project Admin adds a supplier by hand: its names, its Trade and, optionally, a Scope of that Trade. */
export const addApprovedSupplierRequest = z.object({
  name: bilingualText,
  tradeId: z.uuid(),
  scopeId: z.uuid().nullable().default(null),
});
export type AddApprovedSupplierRequest = z.infer<typeof addApprovedSupplierRequest>;
