import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_SCOPES, SAMPLE_TRADES, sampleSnags, sampleSubmittals, type SubmittalEnd } from "./sample-project-plan.ts";

// RP-1217, with the owner's answers of 2026-11-02 (comment on the ticket): 12 in Internal Review,
// 10 Revise and Resubmit (Code C), 50 Pending Approval, 26 closed at Code A or B, 5 Rejected (Code D).

const submittals = sampleSubmittals();
const ends = (...wanted: SubmittalEnd[]) => submittals.filter((s) => wanted.includes(s.end));

describe("the sample Project's Submittals", () => {
  it("has the owner's counts as the List reads them: a chain by its latest item, a Revision where it stands", () => {
    const internal = ends("with_pm", "returned").length + submittals.filter((s) => s.revision).length;
    expect(internal).toBe(12);
    expect(ends("code_c").filter((s) => !s.revision).length).toBe(10);
    expect(ends("with_consultant_engineer", "with_consultant_manager").length).toBe(50);
    expect(ends("code_a", "code_b").length).toBe(26);
    expect(ends("code_d").length).toBe(5);
  });

  it("mixes new items and Revisions in Internal Review, both Contractor Steps", () => {
    expect(ends("with_pm").length).toBeGreaterThan(0);
    expect(ends("returned").length).toBeGreaterThan(0);
    const revised = submittals.filter((s) => s.revision);
    expect(revised.length).toBeGreaterThan(0);
    expect(revised.every((s) => s.end === "code_c")).toBe(true);
    // A Revision back with the Engineer too, not only new items.
    expect(new Set(revised.map((s) => s.revision))).toEqual(new Set(["with_pm", "returned"]));
  });

  it("gives the Manager's queue a spread of Recommended Codes, and each closed item its own Code", () => {
    expect(new Set(ends("with_consultant_manager").map((s) => s.recommendedCode)).size).toBeGreaterThan(1);
    for (const [end, code] of [["code_a", "A"], ["code_b", "B"], ["code_c", "C"], ["code_d", "D"]] as const) {
      expect(ends(end).every((s) => s.recommendedCode === code), end).toBe(true);
    }
  });

  it("uses Code A and Code B for the 26, and each Code B raises a Comment", () => {
    expect(ends("code_a").length).toBeGreaterThan(0);
    expect(ends("code_b").length).toBeGreaterThan(0);
    expect(ends("code_b").every((s) => (s.comments ?? []).length > 0 && s.comments!.every((c) => c.comment.length <= 200))).toBe(true);
  });

  it("has a unique Subject for each item, at most 200 characters", () => {
    const titles = [...submittals.map((s) => s.title), ...sampleSnags().map((s) => s.title)];
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.every((t) => t.length > 0 && t.length <= 200)).toBe(true);
  });

  it("spreads the Trades, so the Mechanical-only Consultant Engineer holds some", () => {
    const trades = new Set(submittals.map((s) => s.trade));
    expect(trades).toEqual(new Set(["EL", "ME", "CV"]));
    expect(ends("with_consultant_engineer").some((s) => s.trade === "ME" && s.consultantEngineer === "sara")).toBe(true);
  });

  it("names only the units the MAR Form's items table offers", () => {
    const form = JSON.parse(readFileSync(new URL("../../../admin/forms/MAR.json", import.meta.url), "utf8"));
    const table = JSON.stringify(form).match(/"key":"unit".*?"options":(\[.*?\])/)!;
    const units = new Set((JSON.parse(table[1]!) as { value: string }[]).map((o) => o.value));
    for (const s of submittals) expect(units, s.title).toContain(s.product.item.unit);
  });

  it("gives a Supplier Approval Request among the MARs", () => {
    expect(submittals.some((s) => s.type === "SAR")).toBe(true);
    expect(submittals.filter((s) => s.type === "MAR").length).toBeGreaterThan(80);
  });
});

describe("the sample Project's Snag List", () => {
  const snags = sampleSnags();

  it("has Snags at every Stage of the Snag Workflow", () => {
    const stages = new Set(snags.filter((s) => s.type === "SNG").map((s) => s.end));
    expect(stages).toEqual(new Set(["draft", "open", "in_progress", "on_hold", "resolved", "closed"]));
  });

  it("has Site Observations", () => {
    expect(snags.some((s) => s.type === "OBS")).toBe(true);
  });

  it("takes some of Code B's Comments on to Resolved and Closed, each Subject the Project's only one", () => {
    const comments = ends("code_b").flatMap((s) => s.comments ?? []);
    expect(new Set(comments.map((c) => c.end))).toEqual(new Set(["open", "resolved", "closed"]));
    const subjects = [...comments.map((c) => c.comment), ...submittals.map((s) => s.title), ...snags.map((s) => s.title)];
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it("puts photos on some Snags", () => {
    expect(snags.filter((s) => (s.photos ?? 0) > 0).length).toBeGreaterThan(5);
  });
});

// RP-1305 (UAT round 0, FRM-04): "This Trade has no Scopes" for Electrical Works. Every Trade the
// sample and UAT Projects use, the General Trade's Site Observations too, gets Scopes in EN and AR.
describe("the sample Project's Scopes", () => {
  const english = (trade: keyof typeof SAMPLE_SCOPES) => SAMPLE_SCOPES[trade].flatMap((s) => [s.name.en, ...(s.subScopes ?? []).map((x) => x.en)]);

  it("gives every Trade Scopes, the General Trade's included", () => {
    expect(Object.keys(SAMPLE_SCOPES).sort()).toEqual([...SAMPLE_TRADES.map((t) => t.code), "GEN"].sort());
    for (const scopes of Object.values(SAMPLE_SCOPES)) expect(scopes.length).toBeGreaterThanOrEqual(3);
  });

  it("gives Electrical Works lighting, power, earthing, cable containment and fire alarm, as FRM-04 picks them", () => {
    const names = english("EL");
    for (const wanted of ["Lighting", "Emergency lighting", "Power distribution", "Earthing", "Cable containment", "Fire alarm"]) {
      expect(names.some((n) => n.startsWith(wanted)), wanted).toBe(true);
    }
  });

  it("names each Scope and Sub-scope in English and Arabic, once in its Trade", () => {
    for (const [trade, scopes] of Object.entries(SAMPLE_SCOPES)) {
      const all = scopes.flatMap((s) => [s.name, ...(s.subScopes ?? [])]);
      for (const name of all) {
        expect(name.en.trim().length, `${trade} ${name.en}`).toBeGreaterThan(0);
        expect(name.ar, `${trade} ${name.en}`).toMatch(/[؀-ۿ]/);
      }
      expect(new Set(all.map((n) => n.en)).size, trade).toBe(all.length);
      expect(new Set(all.map((n) => n.ar)).size, trade).toBe(all.length);
    }
  });

  it("puts a Sub-scope under some Scope, as the Scopes field nests them", () => {
    expect(Object.values(SAMPLE_SCOPES).flat().some((s) => (s.subScopes ?? []).length > 0)).toBe(true);
  });
});
