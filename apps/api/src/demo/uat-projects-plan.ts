import type { BilingualText } from "@rabaed/domain";

// The UAT Projects (RP-1246, RP-1248): one Project per role, so a tester signs in as one demo person
// and runs that person's whole section of the hand-run sheet without switching user. Every UAT Project
// has the same four Companies and the same people as the sample Project (RP-1217), and the same make
// (its Trades, Locations, suppliers and Checklist Templates). Each holds what its role's cases act on,
// already waiting at that role, and the other Companies' work the role must not see.
// The sheet (scripts/uat-sheet.ts) reads the roles from here, so its section titles name these Projects.

/** One role's UAT Project. */
export interface UatRole {
  /** Its number, as the sheet's `role` field on a case names it: "01". */
  n: string;
  /** The Project's code, in its Document Numbers. */
  code: string;
  /** The Project's name. */
  name: BilingualText;
  /** Who the tester signs in as: the demo person's first name, as the sheet's Who's who keys it. */
  person: string;
  /** That person's first name, in English and Arabic. */
  personName: BilingualText;
}

export const UAT_ROLES: UatRole[] = [
  {
    n: "01",
    code: "UAT01",
    name: { en: "UAT 01 · Contractor Engineer (Hafiz)", ar: "UAT 01 · مهندس المقاول (حافظ)" },
    person: "hafiz",
    personName: { en: "Hafiz", ar: "حافظ" },
  },
];
