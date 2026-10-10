import { matchesSearch, type CompanyMember } from "@rabaed/domain";

/** The Members whose name (either language) or email contains the words. */
export function filterMembers<T extends CompanyMember>(members: T[], words: string | undefined): T[] {
  return members.filter((m) => matchesSearch(words, [m.fullName.en, m.fullName.ar, m.email]));
}
