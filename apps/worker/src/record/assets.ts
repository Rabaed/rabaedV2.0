import type { RecordFacts } from "@rabaed/db";
import { PDFDocument } from "pdf-lib";
import type { RecordFiles } from "./files.ts";
import { attachmentFieldKeysOf, isListedDocument } from "./form-content.ts";

// What the layout needs from the item's Documents (form-engine.md §6, elements 8
// and 9): the page counts of the shared Documents, and the photos of the Form as
// images inlined into the page (Chromium needs no network). The worker may read
// Documents under the item's prefix (ADR 0023). A file it can't read or open
// is left without a count or an image, never a failed record.

/** A photo larger than this is listed by name and time only, so a record still opens on a phone. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
/** All the inlined photos together stay under this. */
const MAX_PHOTOS_TOTAL_BYTES = 40 * 1024 * 1024;
/** Image types Chromium draws. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface DocumentAssets {
  /** The page count of each listed Document by storage key; null where it has no pages to count. */
  readonly pageCounts: ReadonlyMap<string, number | null>;
  /** The data URL of each Form photo by storage key. */
  readonly images: ReadonlyMap<string, string>;
}

export async function documentAssets(facts: RecordFacts, files: RecordFiles): Promise<DocumentAssets> {
  const attachmentFields = attachmentFieldKeysOf(facts);
  const pageCounts = new Map<string, number | null>();
  const images = new Map<string, string>();
  let inlined = 0;
  for (const d of facts.documents) {
    if (isListedDocument(d, attachmentFields)) {
      if (IMAGE_TYPES.has(d.contentType)) pageCounts.set(d.storageKey, 1);
      else if (d.contentType === "application/pdf") pageCounts.set(d.storageKey, await pdfPages(files, d.storageKey));
      else pageCounts.set(d.storageKey, null);
    } else if (IMAGE_TYPES.has(d.contentType) && d.size <= MAX_PHOTO_BYTES && inlined + d.size <= MAX_PHOTOS_TOTAL_BYTES) {
      const bytes = await files.get(d.storageKey);
      if (bytes) {
        images.set(d.storageKey, `data:${d.contentType};base64,${Buffer.from(bytes).toString("base64")}`);
        inlined += bytes.length;
      }
    }
  }
  return { pageCounts, images };
}

async function pdfPages(files: RecordFiles, key: string): Promise<number | null> {
  const bytes = await files.get(key);
  if (!bytes) return null;
  try {
    return (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}
