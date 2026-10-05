import { z } from "zod";
import { bilingualText, engineerReason } from "./company.ts";
import { counterStartRequest, numberingCounters } from "./numbering-counter.ts";
import { numberingTypeOverride, saveNumberingPatternRequest, savedNumberingPattern } from "./numbering.ts";
import { setParticipantCodeRequest } from "./participant.ts";

/**
 * Numbering from Rabaed Admin (workflow-engine.md §8 "Who sets the pattern"; ADR
 * 0010). A Rabaed Engineer edits a Project's pattern, Participant Codes and starting
 * numbers with the same rules as its Project Admin, each edit with a reason that is
 * logged in admin_action. The requests are the Project Admin's with a reason added.
 */
export const adminSaveNumberingPatternRequest = saveNumberingPatternRequest.extend({ reason: engineerReason });
export type AdminSaveNumberingPatternRequest = z.infer<typeof adminSaveNumberingPatternRequest>;

export const adminSetParticipantCodeRequest = setParticipantCodeRequest.extend({ reason: engineerReason });
export type AdminSetParticipantCodeRequest = z.infer<typeof adminSetParticipantCodeRequest>;

export const adminCounterStartRequest = counterStartRequest.extend({ reason: engineerReason });
export type AdminCounterStartRequest = z.infer<typeof adminCounterStartRequest>;

/** A Participant of the Project, with its Participant Code (null until set) and whether a number has fixed it. */
export const adminNumberingParticipant = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  code: z.string().nullable(),
  codeLocked: z.boolean(),
  companyName: bilingualText,
});

/**
 * A Project's numbering as a Rabaed Engineer reads it: the patterns in effect (null:
 * the Rabaed Default, or the Project's), its Participants and their codes, and all
 * its counters.
 */
export const adminNumbering = z.object({
  project: savedNumberingPattern.nullable(),
  types: z.array(numberingTypeOverride),
  participants: z.array(adminNumberingParticipant),
  counters: numberingCounters,
});
export type AdminNumbering = z.infer<typeof adminNumbering>;
