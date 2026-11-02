import { describe, expect, it } from "vitest";
import { closesPackage, SAMPLE_CHECKLISTS, sampleInspections, samplePackages, sampleSnags, sampleSubmittals } from "./sample-project-plan.ts";

// RP-1220: the sample Project's Packages (GLOSSARY.md Package): Done, In Progress (with a Code C waiting for its
// Revision) and Open, for more than one Contractor Participant.
const packages = samplePackages();
const submittals = sampleSubmittals();
const byTitle = new Map(submittals.map((s) => [s.title, s]));
/** Every submittal of a Package: those it takes from the Project's Submittals, then its own. */
const itemsOf = (p: (typeof packages)[number]) => [...p.existing.map((t) => byTitle.get(t)!), ...p.submitted];

describe("the sample Project's Packages", () => {
  it("has Open, In Progress and Done Packages for each of the two Contractors", () => {
    for (const owner of ["tmc", "beta"] as const) {
      expect(new Set(packages.filter((p) => p.owner === owner).map((p) => p.status)), owner).toEqual(new Set(["open", "in_progress", "done"]));
    }
  });

  it("takes only the Project's Submittals it names, each in one Package, never a revised one", () => {
    const taken = packages.flatMap((p) => p.existing);
    expect(new Set(taken).size).toBe(taken.length);
    for (const title of taken) {
      expect(byTitle.get(title), title).toBeDefined();
      expect(byTitle.get(title)!.revision, title).toBeUndefined();
    }
    // Only TMC's: the Project's Submittals are TMC's.
    expect(packages.filter((p) => p.existing.length > 0).every((p) => p.owner === "tmc")).toBe(true);
  });

  it("is Done where every submittal closed at Code A, B or D", () => {
    for (const p of packages.filter((p) => p.status === "done")) {
      const items = itemsOf(p);
      expect(items.length, p.name.en).toBeGreaterThan(0);
      expect(items.every((s) => closesPackage(s.end)), p.name.en).toBe(true);
    }
  });

  it("is In Progress where a submittal is still open, and one waits at Code C for its Revision", () => {
    const inProgress = packages.filter((p) => p.status === "in_progress");
    for (const p of inProgress) {
      const items = itemsOf(p);
      expect(items.some((s) => !closesPackage(s.end)), p.name.en).toBe(true);
      expect(p.drafts, p.name.en).toEqual([]);
    }
    expect(inProgress.some((p) => itemsOf(p).some((s) => s.end === "code_c"))).toBe(true);
    // At least one is Submitted as a Package, as the Contractor would.
    expect(inProgress.some((p) => p.submitted.length > 0)).toBe(true);
  });

  it("is Open with Drafts only, nothing Submitted", () => {
    for (const p of packages.filter((p) => p.status === "open")) {
      expect(p.drafts.length, p.name.en).toBeGreaterThan(0);
      expect(p.existing.length + p.submitted.length, p.name.en).toBe(0);
    }
  });

  it("names each Package once per Contractor, and gives its own items Subjects the Project has nowhere else", () => {
    for (const owner of ["tmc", "beta"] as const) {
      const names = packages.filter((p) => p.owner === owner).map((p) => p.name.en);
      expect(new Set(names).size).toBe(names.length);
    }
    const own = packages.flatMap((p) => [...p.submitted.map((s) => s.title), ...p.drafts.map((d) => d.title)]);
    const all = [...own, ...submittals.map((s) => s.title), ...sampleSnags().map((s) => s.title)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives every own submittal its Consultant's Code where it has one", () => {
    for (const s of packages.flatMap((p) => p.submitted)) {
      if (s.end !== "with_consultant_engineer") expect(s.recommendedCode, s.title).toBeDefined();
    }
  });
});

// RP-1220 (the owner's addition): Inspections on the current WIR Workflow, ending with a Review Code (ADR 0025).
describe("the sample Project's Inspections", () => {
  const inspections = sampleInspections();
  const ends = (...wanted: string[]) => inspections.filter((i) => wanted.includes(i.end));

  it("spreads them over every Stage: Draft, Internal Review, Pending Approval, Code A and B, Code C and Rejected", () => {
    for (const end of ["draft", "with_pm", "with_consultant_engineer", "with_consultant_manager", "code_a", "code_b", "code_c", "code_d"]) {
      expect(ends(end).length, end).toBeGreaterThan(0);
    }
  });

  it("re-inspects Code C items as a Revision: one still open, one passed", () => {
    expect(new Set(ends("code_c").map((i) => i.revision))).toEqual(new Set(["open", "passed"]));
    expect(inspections.filter((i) => i.revision).every((i) => i.end === "code_c")).toBe(true);
  });

  it("comes from more than one Contractor", () => {
    expect(new Set(inspections.map((i) => i.owner))).toEqual(new Set(["tmc", "beta"]));
  });

  it("fails only checks its Trade's Checklist has, and fails some where the Code is C or D", () => {
    for (const i of inspections) {
      const keys = SAMPLE_CHECKLISTS[i.trade].checks.map((c) => c.key);
      for (const key of i.failing ?? []) expect(keys, i.title).toContain(key);
    }
    expect(ends("code_c", "code_d").every((i) => (i.failing ?? []).length > 0)).toBe(true);
    expect(ends("code_a", "code_b").every((i) => (i.failing ?? []).length === 0)).toBe(true);
  });

  it("gives each Code B its Comments, and every Subject is the Project's only one", () => {
    expect(ends("code_b").every((i) => (i.comments ?? []).length > 0)).toBe(true);
    const all = [
      ...inspections.flatMap((i) => [i.title, ...(i.comments ?? []).map((c) => c.comment)]),
      ...submittals.flatMap((s) => [s.title, ...(s.comments ?? []).map((c) => c.comment)]),
      ...sampleSnags().map((s) => s.title),
      ...packages.flatMap((p) => [...p.submitted.map((s) => s.title), ...p.drafts.map((d) => d.title)]),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
