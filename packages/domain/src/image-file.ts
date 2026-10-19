/**
 * The image files a Member's Signature (RP-85) and a Company's logo and Stamp (RP-617) are
 * saved as: a PNG or a JPEG, each stored and downloaded with its own extension.
 */
export const imageFileTypes = ["image/png", "image/jpeg"] as const;
export type ImageFileType = (typeof imageFileTypes)[number];

/** Whether a chosen file's `type` is one an image file may be. */
export function isImageFileType(type: string): type is ImageFileType {
  return (imageFileTypes as readonly string[]).includes(type);
}

/** The extension an image file of `type` is stored and downloaded with. */
export function imageFileExtension(type: ImageFileType): "png" | "jpg" {
  return type === "image/png" ? "png" : "jpg";
}
