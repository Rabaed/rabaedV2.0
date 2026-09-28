import { z } from "zod";
import { bilingualText, email } from "./company.ts";
import { locales } from "./locale.ts";

export const PASSWORD_MIN_LENGTH = 12;

/** Length is what matters (NIST SP 800-63B); no composition rules. */
export const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(256);

export const signInRequest = z.object({
  email,
  password: z.string().min(1).max(256),
});
export type SignInRequest = z.infer<typeof signInRequest>;

export const acceptInvitationRequest = z.object({
  token: z.string().min(1).max(200),
  password: newPassword,
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>;

/** GET /v1/me: the signed-in Member and their Company. */
export const signedInMember = z.object({
  member: z.object({
    id: z.uuid(),
    email: z.string(),
    fullName: bilingualText,
    locale: z.enum(locales),
    isAuthorizedPerson: z.boolean(),
    canCreateProjects: z.boolean(),
  }),
  company: z.object({ id: z.uuid(), legalName: bilingualText }),
});
export type SignedInMember = z.infer<typeof signedInMember>;
