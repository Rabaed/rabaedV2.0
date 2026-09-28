import { z } from "zod";
import { bilingualText } from "./company.ts";

/** A Work Item Type's short code, used in filters and Document Numbers (MAR, SAR…). */
export const workItemTypeCode = z.string().regex(/^[A-Z]{2,6}$/);

/** A Contractor Member creates a Work Item in Draft: title, Trade (required), Location and a free-text description. */
export const createWorkItemRequest = z.object({
  type: workItemTypeCode,
  title: z.string().trim().min(1).max(200),
  tradeId: z.uuid(),
  locationId: z.uuid().nullable().default(null),
  description: z.string().trim().max(4000).default(""),
});
export type CreateWorkItemRequest = z.input<typeof createWorkItemRequest>;

export const createdWorkItem = z.object({ id: z.uuid() });

export const stageCategories = ["draft", "in_progress", "closed_positive", "closed_negative", "cancelled"] as const;

const stage = z.object({ key: z.string(), name: bilingualText, category: z.enum(stageCategories) });

/** A Trade or Location as a Work Item shows it. */
const dimensionValueRef = z.object({ id: z.uuid(), code: z.string(), name: bilingualText });

/** A Work Item as a list row. */
export const workItemSummary = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: z.object({ code: z.string(), name: bilingualText }),
  title: z.string(),
  /** Null while Draft. */
  documentNumber: z.string().nullable(),
  stage,
  trade: dimensionValueRef,
  location: dimensionValueRef.nullable(),
  stepEnteredAt: z.iso.datetime(),
  /** Step Age: the week it is in at its current Step, 1, 2, 3… (never a due date). */
  stepAgeWeeks: z.number().int().positive(),
});
export type WorkItemSummary = z.infer<typeof workItemSummary>;

/**
 * A Project's Work Items the viewer can see, and every Stage with how many of
 * them are in it. Counts come from the same visible items, never from all.
 */
export const workItemList = z.object({
  stages: z.array(stage.extend({ count: z.number().int().nonnegative() })),
  items: z.array(workItemSummary),
});
export type WorkItemList = z.infer<typeof workItemList>;

/** One Work Item, for someone who can see it. */
export const workItemDetail = workItemSummary.extend({
  description: z.string(),
  step: z.object({ key: z.string(), name: bilingualText }),
  raisedBy: z.object({ companyName: bilingualText }),
  /**
   * Who holds the current Step. Another Company is shown by its name only; a
   * person's name only within the viewer's own Company (visibility.md V14).
   */
  heldBy: z.object({ companyName: bilingualText, memberName: bilingualText.nullable() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type WorkItemDetail = z.infer<typeof workItemDetail>;

const WEEK = 7 * 86_400_000;

/** Step Age: 1 in the first week at the Step, 2 in the second, and so on. */
export function stepAgeWeeks(enteredAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / WEEK)) + 1;
}

/** Step Age as dots: one per week, up to 4 (4+). */
export function stepAgeDots(weeks: number): number {
  return Math.min(Math.max(weeks, 1), 4);
}
