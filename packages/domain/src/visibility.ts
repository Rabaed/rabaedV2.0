import { z } from "zod";
import { bilingualText } from "./company.ts";
import { withHandovers } from "./handover.ts";

/** The Visibility Dimensions every Project has (docs/data-model.md §3). */
export const dimensionKinds = ["trade", "location"] as const;
export type DimensionKind = (typeof dimensionKinds)[number];

/** A Trade's or Location's code, used in Document Numbers: 2–6 capital letters or digits. */
export const dimensionValueCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,6}$/, "Code must be 2 to 6 letters or digits");

/** A Trade, or a Location in the Zone → Building → Floor tree. */
export const dimensionValue = z.object({
  id: z.uuid(),
  /** Locations only: the Location it is in. */
  parentId: z.uuid().nullable(),
  /** 1 Zone, 2 Building, 3 Floor; always 1 for Trades. */
  depth: z.number().int().min(1).max(3),
  /** "Zone", "Building" or "Floor"; null for Trades. */
  levelName: bilingualText.nullable(),
  code: z.string(),
  name: bilingualText,
});
export type DimensionValue = z.infer<typeof dimensionValue>;

/** Values per dimension: a Project's Trades and Locations, or what someone covers of them. */
export const dimensionValues = z.object({ trade: z.array(dimensionValue), location: z.array(dimensionValue) });
export type DimensionValues = z.infer<typeof dimensionValues>;

/** A Project Admin adds a Trade. */
export const addTradeRequest = z.object({ code: dimensionValueCode, name: bilingualText });
export type AddTradeRequest = z.infer<typeof addTradeRequest>;

/** A Project Admin adds a Location: a Zone, or a Building or Floor inside `parentId`. */
export const addLocationRequest = addTradeRequest.extend({ parentId: z.uuid().nullable().default(null) });
export type AddLocationRequest = z.infer<typeof addLocationRequest>;

/**
 * Visibility in one dimension: all of it, or the listed values (a Location with
 * everything inside it). A Member's "all" is all of their Participant's.
 */
export const visibilityGrant = z.object({ isAll: z.boolean(), valueIds: z.array(z.uuid()) });
export type VisibilityGrant = z.infer<typeof visibilityGrant>;

export const visibility = z.object({ trade: visibilityGrant, location: visibilityGrant });
export type Visibility = z.infer<typeof visibility>;

const grantToSet = visibilityGrant.refine((g) => !g.isAll || g.valueIds.length === 0, {
  message: "Either all, or a list of values",
});

/** Sets Visibility in every dimension at once: saved whole, or not at all. */
export const setVisibilityRequest = z.object({ trade: grantToSet, location: grantToSet });
export type SetVisibilityRequest = z.infer<typeof setVisibilityRequest>;

/** A Project Member's Visibility: each Step they hold whose pool it takes them out of, handed over (RP-108). */
export const setMemberVisibilityRequest = setVisibilityRequest.extend(withHandovers);
export type SetMemberVisibilityRequest = z.infer<typeof setMemberVisibilityRequest>;

/** A Participant's Visibility and the values it covers (for narrowing its Members'). */
export const participantVisibility = z.object({ visibility, covered: dimensionValues });
export type ParticipantVisibility = z.infer<typeof participantVisibility>;

/** A Project Member's Visibility, with the values their Participant covers to choose within. */
export const memberVisibility = z.object({
  member: z.object({ id: z.uuid(), fullName: bilingualText }),
  visibility,
  participant: participantVisibility,
});
export type MemberVisibility = z.infer<typeof memberVisibility>;
