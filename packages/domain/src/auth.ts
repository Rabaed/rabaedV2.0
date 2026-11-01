import { z } from "zod";
import { appearance } from "./appearance.ts";
import { bilingualText, email } from "./company.ts";
import { locales } from "./locale.ts";

export const PASSWORD_MIN_LENGTH = 12;

/** Length is what matters (NIST SP 800-63B); no composition rules. */
export const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(256);

export const signInRequest = z.object({
  email,
  password: z.string().min(1).max(256),
  /** Not read since RP-1174 (the browser's language no longer sets the Member's); accepted so an older page still signs in. */
  locale: z.enum(locales).optional(),
});
export type SignInRequest = z.infer<typeof signInRequest>;

export const acceptInvitationRequest = z.object({
  token: z.string().min(1).max(200),
  password: newPassword,
  /** Not read since RP-1174, as at sign-in. */
  locale: z.enum(locales).optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>;

/**
 * Forgot password (RP-1058): a link valid `validMinutes`, once. Requests are limited per email and
 * per visitor in `windowMinutes`, whatever the email; every answer to a request takes at least
 * `answerAfterMs`, so its time never tells whether the email is registered.
 */
export const PASSWORD_RESET = { validMinutes: 30, perEmail: 5, perVisitor: 20, windowMinutes: 60, answerAfterMs: 300 } as const;

/** A reset link's email, from the worker's outbox handler to the mailer. `token` goes in the link only. */
export interface PasswordResetEmail {
  to: string;
  language: (typeof locales)[number];
  token: string;
  validMinutes: number;
}

export const passwordResetRequest = z.object({ email });
export type PasswordResetRequest = z.infer<typeof passwordResetRequest>;

export const resetPasswordRequest = z.object({
  token: z.string().min(1).max(200),
  password: newPassword,
  /** Not read since RP-1174, as at sign-in. */
  locale: z.enum(locales).optional(),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;

/** GET /v1/me: the signed-in Member and their Company. */
export const signedInMember = z.object({
  member: z.object({
    id: z.uuid(),
    email: z.string(),
    fullName: bilingualText,
    /** The language they were invited in. */
    locale: z.enum(locales),
    /** Their language: what they chose with the language switch, else the one they were invited in. The web app opens in it, and their emails are written in it (RP-1174). */
    language: z.enum(locales),
    isAuthorizedPerson: z.boolean(),
    canCreateProjects: z.boolean(),
  }),
  company: z.object({ id: z.uuid(), legalName: bilingualText }),
  /** Their own Theme and Mode (the default until they choose), so the app paints in it from the first byte. */
  appearance,
});
export type SignedInMember = z.infer<typeof signedInMember>;

/** PUT /v1/me/language: the language the signed-in Member switched to (RP-1174). */
export const setLanguageRequest = z.object({ locale: z.enum(locales) });
export type SetLanguageRequest = z.infer<typeof setLanguageRequest>;
