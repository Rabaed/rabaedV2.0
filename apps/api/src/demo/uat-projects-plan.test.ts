import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UAT_ROLES, uatRecords, type Staged } from "./uat-projects-plan.ts";

// The UAT Projects' plan (RP-1248) against the hand-run sheet's cases (planning/uat/round-0/test-cases.json):
// each case of a role names the items staged for it, by Document Number or, for a Draft, by Subject, and asks the
// tester to be that role's person only. The seeded numbers themselves are checked at seam 1 (test/uat-projects.test.ts).

type Case = { id: string; who: string; title: string; steps: string; expected: string; role?: string; needs?: string[] };
const cases = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../planning/uat/round-0/test-cases.json"), "utf8")) as Case[];

/** The demo people's first names, as the cases' Who lines use them. */
const PEOPLE = ["Saeed", "Hafiz", "Ali", "Omar", "Yousef", "Nasser", "Ahmed", "Sara", "Mohammed", "Layla", "Faisal", "Noura", "Hind"];

/** The Document Numbers of a Project's Submittals as the seed raises them: each Contractor's MARs in its own series, from 0001, Drafts and Cancelled-before-send none. */
function numbersInOrder(code: string, staged: Staged[]): Map<string, string> {
  const next = { tmc: 0, beta: 0 };
  const out = new Map<string, string>();
  for (const s of staged) {
    if (s.kind !== "submittal" || s.item.end === "draft") continue;
    const owner = s.item.owner ?? "tmc";
    out.set(s.item.title, `${code}-MAR-${owner === "tmc" ? "01" : "02"}-${String(++next[owner]).padStart(4, "0")}`);
  }
  return out;
}

describe.each(UAT_ROLES)("UAT $n: $name.en", (role) => {
  const staged = role.staged();
  const mine = cases.filter((c) => c.role === role.n);

  it("plans each Submittal's Document Number in the order the seed raises them", () => {
    const expected = numbersInOrder(role.code, staged);
    for (const s of staged.filter((x) => x.kind === "submittal")) expect(s.number, s.item.title).toBe(expected.get(s.item.title));
  });

  it("gives every staged item a Subject of its own, the seed's key for it", () => {
    const titles = staged.map((s) => s.item.title);
    expect(new Set(titles).size).toBe(titles.length);
    const records = uatRecords(role);
    expect(records.submittals.length + records.snags.length + records.inspections.length).toBe(staged.length);
  });

  it("stages items only for cases in its section, and its section's cases are in the sheet", () => {
    expect(mine.length).toBeGreaterThan(0);
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
