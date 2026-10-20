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

/** A photo larger than this is listed by name, time and fingerprint only, so a record still opens on a phone. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
/** All the inlined photos together stay under this. */
const MAX_PHOTOS_TOTAL_BYTES = 40 * 1024 * 1024;
/** Image types Chromium draws. */
export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface DocumentAssets {
  /** The page count of each listed Document by storage key; null where it has no pages to count. */
  readonly pageCounts: ReadonlyMap<string, number | null>;
  /** The data URL of each Form photo, Signature, logo and Stamp by storage key. */
  readonly images: ReadonlyMap<string, string>;
  /**
   * The SHA-256 (hex) of each inlined image's bytes (photos, Signatures, logos, Stamps), and of each Form
   * photo past the limits (RP-982), by storage key: the Record Data carries it (RP-155).
   */
  readonly fingerprints: ReadonlyMap<string, string>;
}

/** A Document that may be inlined as a photo. */
export interface PhotoCandidate {
  readonly storageKey: string;
  readonly contentType: string;
  /** Its stored size; 0 when not known before it is read. */
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
    // The size is checked again on the bytes read: a Signature, logo or Stamp comes without one (0).
    if (!bytes || bytes.length > MAX_PHOTO_BYTES || inlined + bytes.length > MAX_PHOTOS_TOTAL_BYTES) continue;
    images.set(d.storageKey, `data:${d.contentType};base64,${Buffer.from(bytes).toString("base64")}`);
    fingerprints.set(d.storageKey, createHash("sha256").update(bytes).digest("hex"));
    inlined += bytes.length;
  }
  return { images, fingerprints };
}

/**
 * The Form's and Documents' assets: the listed Documents' page counts and the Form's photos inlined. A
 * Working Copy prints these only (RP-621: no Signature, logo or Stamp); the record adds its marks below.
 */
export async function formAssets(facts: Pick<RecordFacts, "form" | "documents">, files: RecordFiles): Promise<DocumentAssets> {
  const attachmentFields = attachmentFieldKeysOf(facts);
  const pageCounts = new Map<string, number | null>();
  for (const d of facts.documents) {
    if (!isListedDocument(d, attachmentFields)) continue;
    if (IMAGE_TYPES.has(d.contentType)) pageCounts.set(d.storageKey, 1);
    else if (d.contentType === "application/pdf") pageCounts.set(d.storageKey, await pdfPages(files, d.storageKey));
    else pageCounts.set(d.storageKey, null);
  }
  const photos = facts.documents.filter((d) => !isListedDocument(d, attachmentFields));
  const { images, fingerprints } = await inlinePhotos(photos, files);
  // One past the limits prints its name and fingerprint (RP-982): its Document's (RP-618), or, from
  // before RP-618, its stored bytes' (streamed, never held in memory); none when the file is gone.
  for (const d of photos) {
    if (fingerprints.has(d.storageKey)) continue;
    const sha256 = d.sha256 ?? (await files.sha256(d.storageKey));
    if (sha256) fingerprints.set(d.storageKey, sha256);
  }
  return { pageCounts, images, fingerprints };
}

export async function documentAssets(facts: RecordFacts, files: RecordFiles): Promise<DocumentAssets> {
  const { pageCounts, images: formImages, fingerprints: formFingerprints } = await formAssets(facts, files);
  const images = new Map(formImages);
  const fingerprints = new Map(formFingerprints);
  // The Signatures the path's events recorded, and the acting Companies' logos and Stamps in force
  // at close (RP-650): stored under members/ and companies/, which the worker may read (ADR 0023).
  // Inlined as the photos are, with their fingerprints, within limits of their own.
  const seen = new Set<string>();
  const marks = [...facts.transitions.map((t) => t.signature), ...facts.companies.flatMap((c) => [c.logo, c.stamp])].flatMap((m) =>
    m === null || images.has(m.storageKey) || seen.has(m.storageKey) ? [] : (seen.add(m.storageKey), [{ storageKey: m.storageKey, contentType: m.contentType, size: 0 }]),
  );
  const read = await inlinePhotos(marks, files);
  for (const [key, url] of read.images) images.set(key, url);
  for (const [key, sha] of read.fingerprints) fingerprints.set(key, sha);
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
