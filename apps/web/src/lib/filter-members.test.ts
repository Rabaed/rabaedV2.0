import type { CompanyMember } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { filterMembers } from "./filter-members";

const member = (id: string, en: string, ar: string, email: string) =>
  ({ id, fullName: { en, ar }, email }) as unknown as CompanyMember;

const members = [
  member("1", "Saeed Al Qahtani", "سعيد القحطاني", "saeed.alqahtani@tmc.test"),
  member("2", "Hafiz Hamdan", "حافظ حمدان", "hafiz.hamdan@tmc.test"),
];

describe("filterMembers", () => {
  it("keeps everyone for no words or blank words", () => {
    expect(filterMembers(members, undefined)).toHaveLength(2);
    expect(filterMembers(members, "   ")).toHaveLength(2);
  });
  it("matches a name in either language, or the email, ignoring case", () => {
    expect(filterMembers(members, "HAFIZ").map((m) => m.id)).toEqual(["2"]);
    expect(filterMembers(members, "القحطاني").map((m) => m.id)).toEqual(["1"]);
    expect(filterMembers(members, "tmc.test")).toHaveLength(2);
  });
  it("finds nobody for words that match no one", () => {
    expect(filterMembers(members, "zzz")).toEqual([]);
  });
});
