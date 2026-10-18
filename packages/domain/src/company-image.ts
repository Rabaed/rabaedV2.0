import { z } from "zod";
import { bilingualText } from "./company.ts";
import { signedUrl } from "./document.ts";
import { signatureImageTypes } from "./signature.ts";

/**
 * A Company's logo and Stamp (RP-617, ADR 0023), in its Company profile. Its Authorized Person
 * uploads them, and replaces them; every Member of the Company sees them, nobody else. The
 * Documental Record prints the Stamp of every Company whose Members acted, and its logo (or,
 * without one, its name). While a Company has no Stamp, none of its Members can take a
 * Transition (`no_stamp`); the logo is optional and never blocks. A new upload replaces it
 * from then on; a record already made keeps the one it was made with.
 */
export const companyImageKinds = ["logo", "stamp"] as const;
export type CompanyImageKind = (typeof companyImageKinds)[number];

/** The image types a logo or Stamp is saved as: the Signature's. */
export const companyImageTypes = signatureImageTypes;
export type CompanyImageType = (typeof companyImageTypes)[number];

/** The largest logo or Stamp image: 1 MB. */
export const COMPANY_IMAGE_MAX_BYTES = 1024 * 1024;

/** Upload a logo or Stamp: its image, base64-encoded. The api checks the bytes are the PNG or JPEG named. */
export const saveCompanyImageRequest = z.object({
  contentType: z.enum(companyImageTypes),
  // Base64 of at most COMPANY_IMAGE_MAX_BYTES bytes.
  data: z.base64().max(Math.ceil(COMPANY_IMAGE_MAX_BYTES / 3) * 4),
});
export type SaveCompanyImageRequest = z.infer<typeof saveCompanyImageRequest>;

/** A logo or Stamp in force: when it was uploaded, and a short-lived link to its image. */
export const companyImage = z.object({
  id: z.uuid(),
  uploadedAt: z.iso.datetime(),
  image: signedUrl,
});
export type CompanyImage = z.infer<typeof companyImage>;

/**
 * The signed-in Member's own Company profile: its logo and Stamp (null until added), and
 * whether they may upload them (its Authorized Person).
 */
export const myCompany = z.object({
  company: z.object({ id: z.uuid(), legalName: bilingualText, crNumber: z.string(), vatNumber: z.string() }),
  canManage: z.boolean(),
  logo: companyImage.nullable(),
  stamp: companyImage.nullable(),
});
export type MyCompany = z.infer<typeof myCompany>;
