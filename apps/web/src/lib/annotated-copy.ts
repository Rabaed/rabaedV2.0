import type { StartDocumentUploadRequest } from "@rabaed/domain";

// A photo's annotated copy (RP-656, RP-1056): the image the annotate view drew, stored beside its
// original as a Document of its own. The original is never written.

/** The longest file name the api takes. */
const maxFileName = 255;
const suffix = "-annotated.jpg";

/** The drawn image as a file to upload: a JPEG named after its original ("ceiling.jpg" → "ceiling-annotated.jpg"). */
export function annotatedCopyFile(originalName: string, image: Blob): File {
  const dot = originalName.lastIndexOf(".");
  const stem = (dot > 0 ? originalName.slice(0, dot) : originalName).slice(0, maxFileName - suffix.length);
  return new File([image], `${stem}${suffix}`, { type: "image/jpeg" });
}

/**
 * Step 1 of uploading the copy: it names only its original. The api puts it in the original's field,
 * check item and reply (a reply photo's copy is a reply Document too), under the same visibility.
 */
export function annotatedCopyRequest(originalId: string, file: File): StartDocumentUploadRequest {
  return { fileName: file.name, sizeBytes: file.size, contentType: file.type, annotatedFromId: originalId };
}
