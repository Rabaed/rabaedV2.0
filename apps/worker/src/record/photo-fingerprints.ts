import type { RecordBlock, RecordPhoto, RecordSection } from "./form-content.ts";

// The Form photos of a record and their fingerprints (RP-155). The record job inlines each
// photo's image into the page and writes the SHA-256 of that image's bytes into the Record
// Data, so a Re-produce finds the very same file again among the item's Documents by its
// fingerprint (document.file_sha256), never by a name that two photos can share. A photo past
// the inline limits carries its Document's fingerprint and prints it beside its name, with no
// image (RP-982), and a Re-produce prints it the same way, its stored bytes checked. Only one
// from before RP-618 whose file is gone has none, and prints by name and time only.

const photosOfBlock = (block: RecordBlock): readonly RecordPhoto[] =>
  block.kind === "photos" ? block.photos : block.kind === "checklist" ? block.items.flatMap((item) => item.photos) : [];

/** `blocks` with each photo's fingerprint set from `fingerprints` (by storage key). */
export function withFingerprints(blocks: readonly RecordBlock[], fingerprints: ReadonlyMap<string, string>): RecordBlock[] {
  const stamp = (photos: readonly RecordPhoto[]) => photos.map((p) => ({ ...p, sha256: fingerprints.get(p.storageKey) ?? null }));
  return blocks.map((block): RecordBlock => {
    if (block.kind === "photos") return { ...block, photos: stamp(block.photos) };
    if (block.kind === "checklist") return { ...block, items: block.items.map((item) => ({ ...item, photos: stamp(item.photos) })) };
    return block;
  });
}

/** Every photo of `blocks`, in order. */
export const recordPhotos = (blocks: readonly RecordBlock[]): RecordPhoto[] => blocks.flatMap(photosOfBlock);

/** The sections with each photo's fingerprint set. */
export const sectionsWithFingerprints = (sections: readonly RecordSection[], fingerprints: ReadonlyMap<string, string>): RecordSection[] =>
  sections.map((s) => ({ ...s, blocks: withFingerprints(s.blocks, fingerprints) }));

/** Every fingerprint a record's photos carry, once each. */
export function photoFingerprints(blocks: readonly RecordBlock[]): Set<string> {
  return new Set(blocks.flatMap(photosOfBlock).flatMap((p) => (p.sha256 ? [p.sha256] : [])));
}
