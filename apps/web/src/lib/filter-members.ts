import type { CompanyMember } from "@rabaed/domain";

/** The Members whose name (either language) or email contains the words. */
export function filterMembers(members: CompanyMember[], words: string | undefined): CompanyMember[] {
  const needle = (words ?? "").trim().toLocaleLowerCase();
  if (needle === "") return members;
  return members.filter((m) => [m.fullName.en, m.fullName.ar, m.email].some((text) => text.toLocaleLowerCase().includes(needle)));
}
