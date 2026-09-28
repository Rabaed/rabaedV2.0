import { z } from "zod";

/** Saudi Commercial Registration number: ten digits. */
export const crNumber = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "CR number must be 10 digits");

/** Saudi VAT registration number: fifteen digits, starting and ending with 3. */
export const vatNumber = z
  .string()
  .trim()
  .regex(/^3\d{13}3$/, "VAT number must be 15 digits starting and ending with 3");

/** Customer-entered text in both languages (data-model.md: `i18n jsonb`). */
export const bilingualText = z.object({
  en: z.string().trim().min(1).max(200),
  ar: z.string().trim().min(1).max(200),
});
export type BilingualText = z.infer<typeof bilingualText>;

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

/** A Rabaed Engineer's request to onboard a Company and name its Authorized Person. */
export const onboardCompanyRequest = z.object({
  legalName: bilingualText,
  crNumber,
  vatNumber,
  authorizedPerson: z.object({
    email,
    fullName: bilingualText,
    locale: z.enum(["en", "ar"]).default("en"),
  }),
  /** Every Rabaed Engineer action carries a reason (visibility.md V9). */
  reason: z.string().trim().min(1).max(1000),
});
export type OnboardCompanyRequest = z.infer<typeof onboardCompanyRequest>;
