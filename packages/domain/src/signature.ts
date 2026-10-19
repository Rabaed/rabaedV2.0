import { z } from "zod";
import { signedUrl } from "./document.ts";
import { imageFileTypes, type ImageFileType } from "./image-file.ts";

/**
 * A Member's Signature (RP-85, ADR 0023): the image every Transition they take records.
 * Profile → Add Signature draws it (a pen style and colour), types their name in a
 * handwriting style, or uploads an image; each is saved as a PNG or JPEG image. A new one
 * replaces it from then on; a Transition already taken keeps the one it was taken with.
 * Without one, a Member can't take a Transition (`no_signature`).
 */
export const signatureMethods = ["drawn", "typed", "uploaded"] as const;
export type SignatureMethod = (typeof signatureMethods)[number];

/** The image types a Signature is saved as: an image file's (kept for callers of the older name). */
export const signatureImageTypes = imageFileTypes;
export type SignatureImageType = ImageFileType;

/** The largest Signature image: 512 KB. */
export const SIGNATURE_MAX_BYTES = 512 * 1024;

/** The pen styles a drawn Signature offers, by the stroke's width in CSS pixels. */
export const signaturePens = { fine: 1.5, medium: 2.5, bold: 4 } as const;
export type SignaturePen = keyof typeof signaturePens;

/**
 * The ink colours a drawn or typed Signature offers, as the colour drawn into its image: a
 * pen's ink, the same in light and dark mode (the image is printed on the white record),
 * so not a theme token.
 */
export const signatureInks = { black: "#1b1b1f", blue: "#1f3a93" } as const;
export type SignatureInk = keyof typeof signatureInks;

/**
 * The handwriting styles a typed Signature offers, as CSS font stacks the browser draws the
 * name with: the device's own script faces (no handwriting font is bundled), falling back to
 * the generic `cursive`. Arabic names use the device's Arabic calligraphic faces.
 */
export const signatureHands = {
  flowing: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'Diwani Letter', 'Aref Ruqaa', cursive",
  upright: "'Bradley Hand', 'Ink Free', 'Segoe Print', 'Noteworthy', 'DecoType Naskh', cursive",
} as const;
export type SignatureHand = keyof typeof signatureHands;

/**
 * Save a new Signature: how it was made and its image, base64-encoded. The api checks the
 * bytes are the PNG or JPEG named, and no larger than SIGNATURE_MAX_BYTES.
 */
export const saveSignatureRequest = z.object({
  method: z.enum(signatureMethods),
  contentType: z.enum(imageFileTypes),
  // Base64 of at most SIGNATURE_MAX_BYTES bytes.
  data: z.base64().max(Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4),
});
export type SaveSignatureRequest = z.infer<typeof saveSignatureRequest>;

/** The Member's Signature in force: how it was made, since when, and a link to its image. */
export const memberSignature = z.object({
  id: z.uuid(),
  method: z.enum(signatureMethods),
  activeFrom: z.iso.datetime(),
  image: signedUrl,
});
export type MemberSignature = z.infer<typeof memberSignature>;

/** The signed-in Member's own Signature: null until they add one. */
export const mySignature = z.object({ signature: memberSignature.nullable() });
export type MySignature = z.infer<typeof mySignature>;

/**
 * Where saving the Signature takes the Member back to: the item page they came from (the
 * pop-up's link), or the Project page. Anything else (another site, a scheme, `//host`) is
 * null, and the Member stays on their profile.
 */
export function signatureReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\/(work-items|projects)\/[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*\/?$/.test(value) ? value : null;
}
