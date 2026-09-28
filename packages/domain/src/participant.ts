import { z } from "zod";
import { bilingualText, crNumber } from "./company.ts";
import { baseRoles } from "./project.ts";

const projectRole = z.object({ baseRole: z.enum(baseRoles), name: bilingualText });

/** A Project Admin adds another Company, found by its CR number, as a Participant in a Project Role. */
export const addParticipantRequest = z.object({ crNumber, role: z.enum(baseRoles) });
export type AddParticipantRequest = z.infer<typeof addParticipantRequest>;

/** A Participant of a Project, as the Project's Members see it. */
export const projectParticipant = z.object({
  id: z.uuid(),
  company: z.object({ id: z.uuid(), legalName: bilingualText }),
  projectRole,
  /** The viewer's own Company: its Project Members list is theirs to see. */
  isOwnCompany: z.boolean(),
});
export type ProjectParticipant = z.infer<typeof projectParticipant>;

export const projectParticipants = z.object({ participants: z.array(projectParticipant) });
export type ProjectParticipants = z.infer<typeof projectParticipants>;

/** One Project the Authorized Person's Company takes part in (GET /v1/participants). */
export const companyParticipation = z.object({
  id: z.uuid(),
  project: z.object({ id: z.uuid(), projectNumber: z.number().int(), code: z.string(), name: bilingualText }),
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
});
export type SetMemberPositionsRequest = z.infer<typeof setMemberPositionsRequest>;
