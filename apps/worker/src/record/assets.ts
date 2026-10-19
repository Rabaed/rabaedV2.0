import { createHash } from "node:crypto";
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
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface DocumentAssets {
  /** The page count of each listed Document by storage key; null where it has no pages to count. */
  readonly pageCounts: ReadonlyMap<string, number | null>;
  /** The data URL of each Form photo by storage key. */
  readonly images: ReadonlyMap<string, string>;
  /** The SHA-256 (hex) of each inlined photo's bytes by storage key: the Record Data carries it (RP-155). */
  readonly fingerprints: ReadonlyMap<string, string>;
}

/** A Document that may be inlined as a photo. */
export interface PhotoCandidate {
  readonly storageKey: string;
  readonly contentType: string;
  readonly size: number;
}

/**
 * Reads the images among `candidates` into data URLs, within the limits above, with the
 * SHA-256 of each one's bytes. A file it can't read, or that is too large, is left out. The
 * record job and Re-produce both inline photos through this one function.
 */
export async function inlinePhotos(
  candidates: readonly PhotoCandidate[],
  files: RecordFiles,
): Promise<{ images: Map<string, string>; fingerprints: Map<string, string> }> {
  const images = new Map<string, string>();
  const fingerprints = new Map<string, string>();
  let inlined = 0;
  for (const d of candidates) {
    if (!IMAGE_TYPES.has(d.contentType) || d.size > MAX_PHOTO_BYTES || inlined + d.size > MAX_PHOTOS_TOTAL_BYTES) continue;
    const bytes = await files.get(d.storageKey);
    if (!bytes) continue;
    images.set(d.storageKey, `data:${d.contentType};base64,${Buffer.from(bytes).toString("base64")}`);
    fingerprints.set(d.storageKey, createHash("sha256").update(bytes).digest("hex"));
    inlined += bytes.length;
  }
  return { images, fingerprints };
}

export async function documentAssets(facts: RecordFacts, files: RecordFiles): Promise<DocumentAssets> {
  const attachmentFields = attachmentFieldKeysOf(facts);
  const pageCounts = new Map<string, number | null>();
  for (const d of facts.documents) {
    if (!isListedDocument(d, attachmentFields)) continue;
    if (IMAGE_TYPES.has(d.contentType)) pageCounts.set(d.storageKey, 1);
    else if (d.contentType === "application/pdf") pageCounts.set(d.storageKey, await pdfPages(files, d.storageKey));
    else pageCounts.set(d.storageKey, null);
  }
  const { images, fingerprints } = await inlinePhotos(
    facts.documents.filter((d) => !isListedDocument(d, attachmentFields)),
    files,
  );
  return { pageCounts, images, fingerprints };
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
