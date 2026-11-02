import { contentTypeOfFile, moduleTabPaths, type BilingualText, type DocumentSummary, type DraftsVisibleTo, type NewItemRoutePreview } from "@rabaed/domain";
import type { BuiltInChoices } from "@rabaed/ui";
import { isTypeCode, newSubmittalPanelHref } from "./submittal-panel-url.ts";

/** Where a direct link to the Snag List's New page lands (row 5): the Snag List with the create panel at Normal, as the Submittals' does. */
export function snagListLanding(projectId: string, type: string | undefined): string {
  return newSubmittalPanelHref(`/projects/${projectId}/${moduleTabPaths.snag_list}`, "", { size: "normal", ...(type !== undefined && isTypeCode(type) ? { type } : {}) });
}

// The create panel's hooks for the New Snag's short form (RP-1222), apart from React so they are
// tested on their own. Each one leaves the Submittals' panel (RP-1152) as it is when unused.

/**
 * The route preview read's two uses (row 12): the route, shown only where it is previewed, and the
 * Draft Step's "Drafts visible to", which the "who sees this Draft" line follows always (V1), so a
 * Snag whose Draft is the author's alone never reads "Only your Company". Null until the read answers.
 */
export function draftRoute({ routePreview, read }: { routePreview: boolean; read: NewItemRoutePreview | null }): {
  preview: NewItemRoutePreview | null;
  draftsVisibleTo: DraftsVisibleTo | null;
} {
  return { preview: routePreview ? read : null, draftsVisibleTo: read?.draftsVisibleTo ?? null };
}

/** A photo (or file) picked for a Form's field before the Draft exists (row 25): it waits in the browser. */
export type PickedFile = { id: string; fieldKey: string; file: File };

/**
 * The picked files as the Form's file fields show them, beside any the Draft already holds: in their
 * own field, the viewer's own Company's (no person's name, V14), never frozen; each keeps its pick's id.
 */
export function pickedDocuments(picked: readonly PickedFile[], { at, company }: { at: string; company: BilingualText }): DocumentSummary[] {
  return picked.map(({ id, fieldKey, file }) => ({
    id,
    fileName: file.name,
    sizeBytes: file.size,
    contentType: contentTypeOfFile(file),
    uploadedAt: at,
    uploadedBy: { companyName: company, memberName: null },
    frozen: false,
    fieldKey,
    itemKey: null,
    annotatedFromId: null,
    takenAt: null,
    takenWhere: null,
  }));
}

type Upload =(workItemId: string, file: File, where: { fieldKey?: string }) => Promise<{ ok: true } | { ok: false; refused: string }>;

export type SaveThenUpload =
  /** The create was refused: nothing exists, and every picked photo stays. */
  | { kind: "refused"; error?: string; picked: readonly PickedFile[] }
  /** The Draft exists and holds every picked photo. */
  | { kind: "saved"; id: string }
  /** The Draft exists, but an upload failed: the photos from that one on stay picked, for the next Save Draft. */
  | { kind: "photosFailed"; id: string; picked: readonly PickedFile[]; refused: string };

/**
 * Save Draft with photos picked before the Draft existed (row 25, no Documents lock): the Draft is
 * created (`create`; on a retry, the Draft already made), then each photo is uploaded to it, in
 * order, through the item's own upload (the raiser's Draft alone holds them). The first failed
 * upload stops it, so the form keeps the rest and says so.
 */
export async function saveThenUpload({ picked, create, upload }: { picked: readonly PickedFile[]; create: () => Promise<{ ok: true; id: string } | { ok: false; error?: string }>; upload: Upload }): Promise<SaveThenUpload> {
  const created = await create();
  if (!created.ok) return { kind: "refused", error: created.error, picked };
  for (const [i, p] of picked.entries()) {
    const result = await upload(created.id, p.file, { fieldKey: p.fieldKey });
    if (!result.ok) return { kind: "photosFailed", id: created.id, picked: picked.slice(i), refused: result.refused };
  }
  return { kind: "saved", id: created.id };
}

/**
 * The answers a new Draft starts with: the Form's first Trade, and a Location given on opening
 * (a Floor plan's way in, row 23) only when the Member's Visibility covers it, so the panel never
 * shows a value they may not see. One not covered is left blank, with nothing said.
 */
export function startAnswers({
  tradeId,
  given,
  choices,
}: {
  tradeId: string | undefined;
  given: { location?: string } | undefined;
  choices: Pick<BuiltInChoices, "locations">;
}): Record<string, unknown> {
  const location = given?.location;
  return {
    ...(tradeId !== undefined ? { trade: tradeId } : {}),
    ...(location !== undefined && choices.locations.some((l) => l.id === location) ? { location } : {}),
  };
}
