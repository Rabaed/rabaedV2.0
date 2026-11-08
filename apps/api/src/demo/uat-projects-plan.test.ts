import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UAT_ROLES, uatPeople, uatRecords, type Staged } from "./uat-projects-plan.ts";

// The UAT Projects' plan (RP-1248) against the hand-run sheet's cases (planning/uat/round-0/test-cases.json):
// each case of a role names the items staged for it, by Document Number or, for a Draft, by Subject, and asks the
// tester to be that role's person only. The seeded numbers themselves are checked at seam 1 (test/uat-projects.test.ts).

type Case = { id: string; who: string; title: string; steps: string; expected: string; role?: string; needs?: string[]; leftover?: string };
const cases = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../planning/uat/round-0/test-cases.json"), "utf8")) as Case[];

/** The demo people's first names, as the cases' Who lines use them. */
const PEOPLE = ["Saeed", "Hafiz", "Ali", "Omar", "Yousef", "Nasser", "Ahmed", "Sara", "Mohammed", "Layla", "Faisal", "Noura", "Hind"];

/** The Document Numbers of a Project's Submittals as the seed raises them: each Contractor's own series per Type (MAR, SAR), from 0001, Drafts none. */
function numbersInOrder(code: string, staged: Staged[]): Map<string, string> {
  const next = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of staged) {
    // A DAR (RP-1250) is TMC's, and numbers in its own series as a SAR does.
    const item = s.kind === "submittal" ? s.item : s.kind === "dar" ? { ...s.item, type: "DAR", owner: "tmc" as const } : undefined;
    if (!item || item.end === "draft") continue;
    const owner = item.owner ?? "tmc";
    const key = `${owner}:${item.type}`;
    next.set(key, (next.get(key) ?? 0) + 1);
    out.set(item.title, `${code}-${item.type}-${owner === "tmc" ? "01" : "02"}-${String(next.get(key)).padStart(4, "0")}`);
  }
  return out;
}

describe("the UAT roles (RP-1248, RP-1249, RP-1250)", () => {
  it("are UAT 01 to 10, one person each, named for the role and the person", () => {
    expect(UAT_ROLES.map((r) => [r.n, r.code, r.person])).toEqual([
      ["01", "UAT01", "hafiz"],
      ["02", "UAT02", "ali"],
      ["03", "UAT03", "saeed"],
      ["04", "UAT04", "ahmed"],
      ["05", "UAT05", "mohammed"],
      ["06", "UAT06", "layla"],
      ["07", "UAT07", "noura"],
      ["08", "UAT08", "yousef"],
      ["09", "UAT09", "omar"],
      ["10", "UAT10", "sara"],
    ]);
    for (const r of UAT_ROLES) {
      expect(r.name.en, r.n).toMatch(new RegExp(`^UAT ${r.n} · .+ \\(${r.personName.en}\\)$`));
      expect(r.name.ar, r.n).toMatch(new RegExp(`^UAT ${r.n} · .+ \\(${r.personName.ar}\\)$`));
    }
  });

  it("put Omar on TMC in every UAT Project, Podium only, as Riyadh Gate Tower narrows him to one Location (RP-1250)", () => {
    const omar = { who: "omar", company: "saeed", positions: ["engineer"], grant: { locations: ["PD"] } };
    // On UAT 03 Saeed also covers all of TMC's work, with no Position, so PAR-17's seen item is his to read (RP-1264).
    for (const r of UAT_ROLES) expect(uatPeople(r).add, r.n).toEqual(r.n === "03" ? [omar, { who: "saeed", company: "saeed", positions: [] }] : [omar]);
  });

  it("leave Design Consultants on UAT 06 without Civil, with Ahmed alone on Electrical, so Layla's cases have a Trade it lacks and a gap to warn of (RP-1250)", () => {
    const people = uatPeople(UAT_ROLES.find((r) => r.n === "06")!);
    expect(people.participants).toEqual({ layla: { trades: ["EL", "ME"] } });
    expect(people.leaveOff).toEqual(["sara", "mohammed"]);
    expect(people.grants).toEqual({ ahmed: { trades: ["EL"] } });
    for (const r of UAT_ROLES.filter((x) => x.n !== "06")) expect(uatPeople(r).leaveOff ?? [], r.n).toEqual([]);
  });

  it("put Gulf Review Consultants on UAT 03 only, holding PAR-17's two items, so withdrawing it touches no other case (RP-1264)", () => {
    for (const r of UAT_ROLES) expect(uatPeople(r).join ?? [], r.n).toEqual(r.n === "03" ? ["tariq"] : []);
    const uat03 = UAT_ROLES.find((r) => r.n === "03")!.staged();
    const held = uat03.filter((s) => s.kind === "submittal" && s.item.consultantEngineer === "tariq");
    // One of TMC's, which Saeed sees, and one of Beta Build's, which he must not: both at Tariq's Consultant Engineer Step.
    expect(held.map((s) => [s.cases, s.number, s.mustNotSee ?? false, s.kind === "submittal" && s.item.end])).toEqual([
      [["PAR-17"], "UAT03-MAR-01-0002", false, "with_consultant_engineer"],
      [["PAR-17"], "UAT03-MAR-02-0001", true, "with_consultant_engineer"],
    ]);
    // Every other UAT 03 item stays with Design Consultants, and no other case names the staged Company's items.
    for (const s of uat03.filter((x) => !held.includes(x))) expect(s.cases, s.item.title).not.toContain("PAR-17");
    for (const c of cases.filter((x) => x.id !== "PAR-17")) expect(`${c.steps}\n${c.expected}`, c.id).not.toMatch(/Gulf Review|Tariq/);
  });
});

describe.each(UAT_ROLES)("UAT $n: $name.en", (role) => {
  const staged = role.staged();
  const mine = cases.filter((c) => c.role === role.n);
  const packages = role.packages?.() ?? [];

  it("names each of its Packages, by name, in the cases that use it, and builds them from its own items", () => {
    const titles = new Set(staged.map((s) => s.item.title));
    for (const p of packages) {
      for (const id of p.cases) {
        const c = mine.find((x) => x.id === id);
        expect(c, `${p.package.name.en}: ${id} is in the section`).toBeDefined();
        expect(`${c!.steps}\n${c!.expected}`, `${id} names ${p.package.name.en}`).toContain(p.package.name.en);
      }
      for (const title of p.package.existing) expect(titles.has(title), `${p.package.name.en} takes in ${title}`).toBe(true);
      for (const d of p.package.drafts) expect(titles.has(d.title), `${d.title} is the Package's own, not a staged item too`).toBe(false);
    }
    expect(uatRecords(role).packages).toEqual(packages.map((p) => p.package));
  });

  it("plans each Submittal's Document Number in the order the seed raises them", () => {
    const expected = numbersInOrder(role.code, staged);
    for (const s of staged.filter((x) => x.kind === "submittal" || x.kind === "dar")) expect(s.number, s.item.title).toBe(expected.get(s.item.title));
  });

  it("gives every staged item a Subject of its own, the seed's key for it", () => {
    const titles = staged.map((s) => s.item.title);
    expect(new Set(titles).size).toBe(titles.length);
    const records = uatRecords(role);
    expect(records.submittals.length + records.snags.length + records.inspections.length + (records.dars?.length ?? 0)).toBe(staged.length);
  });

  it("stages items only for cases in its section, and its section's cases are in the sheet", () => {
    expect(mine.length).toBeGreaterThan(0);
    for (const c of mine) expect(c.leftover, `${c.id} is in a section and left over`).toBeUndefined();
    const ids = new Set(mine.map((c) => c.id));
    for (const s of staged) for (const id of s.cases) expect(ids.has(id), `${s.item.title}: ${id}`).toBe(true);
  });

  it("has each case name the items staged for it: a Document Number, or a Draft's Subject", () => {
    for (const c of mine) {
      const text = `${c.steps}\n${c.expected}`;
      for (const s of staged.filter((x) => x.cases.includes(c.id) && !x.mustNotSee)) {
        expect(text, `${c.id} names ${s.item.title}`).toContain(s.number ?? s.item.title);
      }
    }
  });

  it("asks the tester to be its person only, in its Project, never Riyadh Gate Tower", () => {
    const person = role.personName.en;
    for (const c of mine) {
      expect(c.who, c.id).toMatch(new RegExp(`^${person}\\b`));
      for (const other of PEOPLE.filter((p) => p !== person)) expect(c.who, `${c.id} Who names ${other}`).not.toMatch(new RegExp(`\\b${other}\\b`));
      expect(`${c.steps}\n${c.expected}`, c.id).not.toMatch(/Riyadh Gate Tower|\bTWR-/);
      expect(c.needs ?? [], c.id).not.toContain("owner");
    }
  });

  it("names the role's visibility targets in its visibility cases", () => {
    for (const s of staged.filter((x) => x.mustNotSee)) {
      for (const id of s.cases) {
        const c = mine.find((x) => x.id === id)!;
        expect(`${c.steps}\n${c.expected}`, `${id} looks for ${s.item.title}`).toContain(s.number ?? s.item.title);
      }
    }
  });
});
