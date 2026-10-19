import { answerFields, type BilingualText, type DocumentSummary, type FormSchema, type WorkItemHistory } from "@rabaed/domain";

type Event = WorkItemHistory["events"][number];

/** The Contractor's response to a Snag, as the page shows it: what was done, by which Company, and its "after" photos. */
export type SnagResponseRead = { resolution: string; by: BilingualText | null; after: DocumentSummary[] };

/** The Snag's reply Screen field for what was done (`apps/admin/screens/snag_resolution.json`), shared with everyone who sees the Resolve. */
// eslint-disable-next-line rabaed/no-avoid-terms -- the Screen field's published key, data rather than copy.
const resolutionKey = "resolution_note";

/**
 * The Contractor's response the raiser verifies (RP-628): what was done and the "after" photos of the
 * latest Resolve, as the viewer's history reads them (shared events only, V5; files as the
 * viewer sees them, ADR 0024). Only while the item sits after that Resolve: at Verify, or closed
 * from it. Once returned to Open, that round lives in the history, and a new Resolve starts
 * its own.
 */
export function snagResponse(
  events: readonly Event[],
  documents: readonly DocumentSummary[],
  { closed }: { closed: boolean },
): SnagResponseRead | null {
  const moves = events.filter((e) => e.type === "transition" && e.audience === "shared");
  const resolveIndex = moves.findLastIndex((e) => typeof e.answers?.[resolutionKey] === "string");
  if (resolveIndex === -1) return null;
  const movesAfterResolve = moves.length - 1 - resolveIndex;
  if (movesAfterResolve > (closed ? 1 : 0)) return null;
  const resolve = moves[resolveIndex]!;
  const byId = new Map(documents.map((d) => [d.id, d]));
  return {
    resolution: resolve.answers![resolutionKey] as string,
    by: resolve.by.companyName,
    after: (resolve.files ?? []).flatMap((id) => byId.get(id) ?? []),
  };
}

/** The "before" photos: the images of the Form's photos fields, never a reply Screen's file or an annotated copy. */
export function beforePhotos(schema: FormSchema, documents: readonly DocumentSummary[]): DocumentSummary[] {
  const fields = new Set(answerFields(schema).flatMap((f) => (f.type === "photos" ? [f.key] : [])));
  return documents.filter((d) => d.fieldKey !== null && fields.has(d.fieldKey) && !d.reply && d.itemKey === null && d.annotatedFromId === null);
}
