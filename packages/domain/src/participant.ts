import { z } from "zod";
import { bilingualText, crNumber } from "./company.ts";
import { withHandovers } from "./handover.ts";
import { baseRoles } from "./project.ts";

const projectRole = z.object({ baseRole: z.enum(baseRoles), name: bilingualText });

/**
 * A Project Admin invites another Company, found by its CR number, to be a
 * Participant in a Project Role. The answer is the same whether or not the CR
 * number is on Rabaed (ADR 0009).
 */
export const addParticipantRequest = z.object({ crNumber, role: z.enum(baseRoles) });
export type AddParticipantRequest = z.infer<typeof addParticipantRequest>;

/**
 * A Project's pending Participant Invitations, for its Project Admins: by the
 * CR number they entered, alike whether or not it is on Rabaed, and never with
 * a Company's name (ADR 0009).
 */
export const projectInvitations = z.object({
  invitations: z.array(z.object({ id: z.uuid(), crNumber: z.string(), projectRole, invitedAt: z.iso.datetime() })),
});
export type ProjectInvitations = z.infer<typeof projectInvitations>;

/**
 * A pending Participant Invitation, as the invited Company's Authorized Person
 * sees it: the Project's name, its Host Company and the offered Project Role,
 * and nothing else of the Project until they accept (V15, ADR 0009).
 */
export const companyInvitation = z.object({
  id: z.uuid(),
  project: z.object({ name: bilingualText }),
  hostCompany: z.object({ legalName: bilingualText }),
  projectRole,
  invitedAt: z.iso.datetime(),
});
export type CompanyInvitation = z.infer<typeof companyInvitation>;

export const companyInvitations = z.object({ invitations: z.array(companyInvitation) });
export type CompanyInvitations = z.infer<typeof companyInvitations>;

/**
 * A CR number a Project Admin invited that wasn't on Rabaed, for Rabaed to
 * onboard, open or converted: seen only through Rabaed Admin (V9, ADR 0009).
 */
export const onboardingLeads = z.object({
  leads: z.array(
    z.object({
      id: z.uuid(),
      crNumber: z.string(),
      project: z.object({ id: z.uuid(), projectNumber: z.number().int(), code: z.string(), name: bilingualText }),
      hostCompany: z.object({ id: z.uuid(), legalName: bilingualText }),
      baseRole: z.enum(baseRoles),
      requestedAt: z.iso.datetime(),
      /** Set once Rabaed onboarded the Company and the lead became its Participant Invitation (kept for audit). */
      convertedAt: z.iso.datetime().nullable(),
      participantId: z.uuid().nullable(),
    }),
  ),
});
export type OnboardingLeads = z.infer<typeof onboardingLeads>;

/** A Participant of a Project, as its Project Admins, and its own Company's Members, see it. */
export const projectParticipant = z.object({
  id: z.uuid(),
  company: z.object({ id: z.uuid(), legalName: bilingualText }),
  projectRole,
  /** The Participant Code in the Project's Document Numbers; null until a Project Admin sets it. */
  code: z.string().nullable(),
  /**
   * Its order on the Project (1, 2, …): what its Document Numbers print until a code
   * is set. Only for Project Admins, null for anyone else: orders are max+1, so even a
   * Participant's own would tell how many others there are (visibility.md RP-381-1).
   */
  ordinal: z.number().int().nullable(),
  /** Whether a Document Number (or a starting number) has fixed its code: it can no longer change. */
  codeLocked: z.boolean(),
  /** The viewer's own Company: its Project Members list is theirs to see. */
  isOwnCompany: z.boolean(),
});
export type ProjectParticipant = z.infer<typeof projectParticipant>;

/** The Company that hosts a Project: the one other Company every Participant sees by name (V15). */
const hostCompany = z.object({ legalName: bilingualText });

/**
 * The Participants of a Project the viewer may list: every one for its Project
 * Admins, otherwise only the viewer's own Company's (V15).
 */
export const projectParticipants = z.object({ hostCompany, participants: z.array(projectParticipant) });
export type ProjectParticipants = z.infer<typeof projectParticipants>;

/** One Project the Authorized Person's Company takes part in (GET /v1/participants). */
export const companyParticipation = z.object({
  id: z.uuid(),
  project: z.object({ id: z.uuid(), projectNumber: z.number().int(), code: z.string(), name: bilingualText }),
  hostCompany,
  projectRole,
});
export type CompanyParticipation = z.infer<typeof companyParticipation>;

export const companyParticipations = z.object({ participants: z.array(companyParticipation) });
export type CompanyParticipations = z.infer<typeof companyParticipations>;

/** A Participant's Project Members; private to that Participant's Company. */
export const participantMembers = z.object({
  participant: companyParticipation,
  members: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      fullName: bilingualText,
      /** Keys of the Positions they hold on this Project. */
      positions: z.array(z.string()),
    }),
  ),
  /** The Positions of the Participant's base role, to choose from. */
  positions: z.array(z.object({ key: z.string(), name: bilingualText })),
});
export type ParticipantMembers = z.infer<typeof participantMembers>;

/** The Participant's Authorized Person adds a Member of their own Company to the Project. */
export const addProjectMemberRequest = z.object({ memberId: z.uuid() });
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequest>;

/**
 * The Participant's Authorized Person sets a Project Member's Positions (e.g.
 * Engineer, Project Manager): what they may do on the Project's Work Items.
 */
export const setMemberPositionsRequest = z.object({
  positions: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(10),
  /** Each Step they hold whose pool the new Positions take them out of, handed over (RP-108). */
  ...withHandovers,
});
export type SetMemberPositionsRequest = z.infer<typeof setMemberPositionsRequest>;

/** The Participant's Authorized Person removes a Project Member, handing each Step they hold there over (RP-108). */
export const removeProjectMemberRequest = z.object(withHandovers);
export type RemoveProjectMemberRequest = z.infer<typeof removeProjectMemberRequest>;

/**
 * A Project Admin sets a Participant's Participant Code: 2 to 6 letters or digits
 * with at least one letter, stored in capitals, unique in the Project and fixed
 * once a Document Number uses it.
 */
export const setParticipantCodeRequest = z.object({ code: z.string().max(20) });
export type SetParticipantCodeRequest = z.infer<typeof setParticipantCodeRequest>;

/** The refusals of setting a Participant Code (app.set_participant_code, app.assign_participant_code). */
export const participantCodeRefusals = ["not_found", "project_closed", "invalid_code", "duplicate_code", "code_in_use"] as const;
