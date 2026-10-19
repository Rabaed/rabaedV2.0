import { createHash } from "node:crypto";
import type { ImageFileType } from "@rabaed/domain";
import type { FileStore } from "../documents/file-store.ts";

// An image the api received and stores itself: a Member's Signature (RP-85), a Company's logo or
// Stamp (RP-617). The api checks the bytes, stores them under the key, then a database function
// records them; when it records nothing, or fails, nothing points at the image, so it is removed.

/** The first bytes of each image file type. */
const magic: Record<ImageFileType, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

/** Whether `bytes` are an image of `contentType` (PNG or JPEG), at most `maxBytes` long. */
export function isImageOf(bytes: Uint8Array, contentType: ImageFileType, maxBytes: number): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return false;
  return magic[contentType].every((b, i) => bytes[i] === b);
}

/** The stored image, as the database function that records it takes it. */
export type StoredImage = { key: string; sha256: Buffer; size: number; mime: ImageFileType };

/**
 * Stores `bytes` under `key`, then `record`s them. When `recorded` says the outcome kept
 * nothing, or `record` throws, the stored image is removed (and the error rethrown).
 */
export async function storeImage<T>(
  files: FileStore,
  image: { key: string; bytes: Uint8Array; contentType: ImageFileType },
  record: (stored: StoredImage) => Promise<T>,
  recorded: (outcome: T) => boolean,
): Promise<T> {
  await files.put(image.key, image.bytes, image.contentType);
  try {
    const outcome = await record({
      key: image.key,
      sha256: createHash("sha256").update(image.bytes).digest(),
      size: image.bytes.byteLength,
      mime: image.contentType,
    });
    if (!recorded(outcome)) await files.remove(image.key);
    return outcome;
  } catch (error) {
    // Nothing points at the stored image: remove it.
    await files.remove(image.key).catch(() => undefined);
    throw error;
  }
}
