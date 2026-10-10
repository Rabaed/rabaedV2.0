import { z } from "zod";
import { bilingualText, email } from "./company.ts";
import { locales } from "./locale.ts";

export const memberStatuses = ["invited", "active", "locked", "deactivated"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

/** One row of a Company's Members list (GET /v1/members). Private to the Company. */
export const companyMember = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: bilingualText,
  locale: z.enum(locales),
  status: z.enum(memberStatuses),
  isAuthorizedPerson: z.boolean(),
  /** Project Creator. */
  canCreateProjects: z.boolean(),
});
export type CompanyMember = z.infer<typeof companyMember>;

/** A row of the Members page: the Member and the number of their own Company's active Projects they are on (any Member reads it of a colleague; never which Projects). */
export const listedMember = companyMember.extend({ projectCount: z.number().int().nonnegative() });
export type ListedMember = z.infer<typeof listedMember>;

export const companyMembers = z.object({ members: z.array(listedMember) });
export type CompanyMembers = z.infer<typeof companyMembers>;

/** The Authorized Person invites a Member of their Company. */
export const inviteMemberRequest = z.object({
  email,
  fullName: bilingualText,
  locale: z.enum(locales).default("en"),
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequest>;

/** Shown once, for the Authorized Person to pass on (email delivery comes later). */
const invitation = z.object({ token: z.string(), expiresAt: z.date() });

export const invitedMember = z.object({ memberId: z.uuid(), invitation });

/**
 * A deactivated Member, reactivated as the same Member (visibility.md V17). One
 * who never accepted their first invitation gets a new one.
 */
export const reactivatedMember = z.object({ member: companyMember, invitation: invitation.optional() });

/** The Authorized Person marks a Member as a Project Creator, or not. */
export const updateMemberRequest = z.object({ canCreateProjects: z.boolean() });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequest>;
