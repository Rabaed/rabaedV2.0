import { z } from "zod";
import { bilingualText } from "./company.ts";
import { moduleKeySchema } from "./module.ts";
import { fromBase64Url, toBase64Url } from "./work-item-query.ts";
import { workItemEventTypes, workItemOutcome, workItemTypeCode } from "./work-item.ts";

/**
 * The Activity Feed (spec RP-344, RP-353; visibility.md "Activity Feed"): the
 * Project's Work Item events as the viewer may see them, newest first, a page
 * at a time. It is read through the same rules as an item's history (layers 3
 * to 5, V5, V19), with another Company named only by its name and people named
 * only within the viewer's own Company (V14). Answer changes and Document
 * events are left out.
 */

/** Entries per page, unless the caller asks for another size. */
export const activityFeedPageSize = 30;

const list = <T extends z.ZodType>(item: T) =>
  z
    .preprocess(
      (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((s) => (typeof s === "string" ? s.split(",") : [s])).filter((s) => s !== "")),
      z.array(item).max(100),
    )
    .transform((values) => [...new Set(values)]);

const activityFeedFields = {
  /** One Module's items only. */
  module: moduleKeySchema.optional(),
  /** These Work Item Types' items only. */
  type: list(workItemTypeCode),
  /** "Items I'm on": ones I raised, held, or acted on. */
  mine: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()),
  /** Where the page starts: the `nextCursor` of the page before. */
  cursor: z
    .string()
    .max(1000)
    .refine((c) => decodeActivityCursor(c) !== null, "Not an Activity Feed cursor")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(activityFeedPageSize),
};

export const activityFeedQuery = z.object(activityFeedFields);
export type ActivityFeedQuery = z.infer<typeof activityFeedQuery>;

/** The query parameters of `query`, its defaults left out, in a stable order. */
export function activityFeedSearchParams(query: Partial<ActivityFeedQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.module) params.set("module", query.module);
  if (query.type && query.type.length > 0) params.set("type", query.type.join(","));
  if (query.mine) params.set("mine", "true");
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined && query.limit !== activityFeedPageSize) params.set("limit", String(query.limit));
  return params;
}

// The last entry's event id, opaque to the client: the database finds where it
// sorts, so the stored `seq`, whose gaps would count other Participants' internal
// events (V5), never leaves it. Checked here, so a tampered cursor is refused
// before it reaches a query; one naming an event the Member can't see gives an
// empty page, as for an id that doesn't exist.
const cursorTag = "activity";
const uuid = z.uuid();

export function encodeActivityCursor(id: string): string {
  return toBase64Url(JSON.stringify([cursorTag, id]));
}

/** The last entry a cursor names, or null when it isn't an Activity Feed cursor. */
export function decodeActivityCursor(cursor: string): { id: string } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2 || decoded[0] !== cursorTag) return null;
  const [, id] = decoded as unknown[];
  if (typeof id !== "string" || !uuid.safeParse(id).success) return null;
  return { id };
}

export const activityFeed = z.object({
  entries: z.array(
    z.object({
      /** The event's id: a stable key for the entry. */
      id: z.uuid(),
      type: z.enum(workItemEventTypes),
      at: z.iso.datetime(),
      /** "internal": seen only within the viewer's own Participant (V5). */
      audience: z.enum(["shared", "internal"]),
      /** Another Company by its name only; a person only within the viewer's own Company (V14). */
      by: z.object({ companyName: bilingualText.nullable(), memberName: bilingualText.nullable() }),
      /** The Transition taken, or the one an Internal Note was written with. */
      transition: bilingualText.nullable(),
      /** Set on the event that closed the item: the Issued Code. */
      outcome: workItemOutcome.nullable(),
      workItem: z.object({
        id: z.uuid(),
        documentNumber: z.string().nullable(),
        title: z.string(),
        type: z.object({ code: z.string(), name: bilingualText }),
      }),
    }),
  ),
  nextCursor: z.string().nullable(),
  /** The Project's Work Item Types by Module, for the Module and Type filters (no counts). */
  types: z.array(z.object({ code: z.string(), name: bilingualText, moduleKey: moduleKeySchema })),
});
export type ActivityFeed = z.infer<typeof activityFeed>;
export type ActivityFeedEntry = ActivityFeed["entries"][number];
