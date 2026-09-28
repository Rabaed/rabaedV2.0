import { z } from "zod";
import { email } from "./company.ts";

/** Length is what matters (NIST SP 800-63B); no composition rules. */
export const newPassword = z.string().min(12, "Use at least 12 characters").max(256);

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
