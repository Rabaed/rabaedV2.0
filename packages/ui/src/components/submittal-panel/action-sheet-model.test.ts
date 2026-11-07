import type { WorkflowDefinition } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { actionSheetEffects } from "./action-sheet-model.ts";

// RP-1237 (gap table v3 row 30): "What happens when you confirm", built from the Workflow map the viewer
// reads: the Stage it moves to, who is told, how many Comments open, whether a Revision follows, and that a
// Code is printed on the Documental Record. Never a "stamp" (GLOSSARY Stamp), never a date.

const bi = (en: string) => Object.fromEntries([["en", en], ["ar", en]]) as { en: string; ar: string };

const definition = {
  steps: [
    { key: "review", name: bi("Review"), stage: "pending_approval" },
    { key: "approved", name: bi("Approved"), stage: "approved" },
    { key: "noted", name: bi("Approved as noted"), stage: "approved_noted" },
    { key: "revise", name: bi("Revise"), stage: "revise" },
    { key: "draft", name: bi("Draft"), stage: "draft" },
  ],
  transitions: [
    { key: "approve_a", kind: "close", from: "review", to: "approved", outcome: "A" },
    { key: "approve_b", kind: "close", from: "review", to: "noted", outcome: "B" },
    { key: "revise_c", kind: "close", from: "review", to: "revise", outcome: "C" },
    { key: "send_back", kind: "send_back", from: "review", to: "draft", outcome: null },
  ],
} as unknown as WorkflowDefinition;

const stages = [
  { key: "pending_approval", name: bi("Pending Approval") },
  { key: "approved", name: bi("Approved") },
  { key: "approved_noted", name: bi("Approved as Noted") },
  { key: "revise", name: bi("Revise & Resubmit") },
  { key: "draft", name: bi("Draft") },
];
const tmc = bi("TMC Constructions");

describe("what happens when the viewer confirms a Transition", () => {
  it("Code A: the Stage it moves to, who is told, and the Code printed on the Documental Record", () => {
    expect(actionSheetEffects({ transitionKey: "approve_a", definition, stages, goesTo: tmc, code: "A", offersRevision: false, comments: null })).toEqual([
      { kind: "stage", name: bi("Approved") },
      { kind: "told", company: tmc },
      { kind: "record", code: "A" },
    ]);
  });

  it("Code B: how many Comments open, counted from the rows typed, for whom", () => {
    expect(actionSheetEffects({ transitionKey: "approve_b", definition, stages, goesTo: tmc, code: "B", offersRevision: false, comments: 2 })).toEqual([
      { kind: "stage", name: bi("Approved as Noted") },
      { kind: "comments", count: 2, company: tmc },
      { kind: "record", code: "B" },
    ]);
  });

  it("Code B before any row is typed: who is told, not \"0 Comments\"", () => {
    expect(actionSheetEffects({ transitionKey: "approve_b", definition, stages, goesTo: tmc, code: "B", offersRevision: false, comments: 0 })).toEqual([
      { kind: "stage", name: bi("Approved as Noted") },
      { kind: "told", company: tmc },
      { kind: "record", code: "B" },
    ]);
  });

  it("Code C: back to the raiser for a new Revision", () => {
    expect(actionSheetEffects({ transitionKey: "revise_c", definition, stages, goesTo: tmc, code: "C", offersRevision: true, comments: null })).toEqual([
      { kind: "stage", name: bi("Revise & Resubmit") },
      { kind: "revision", company: tmc },
      { kind: "record", code: "C" },
    ]);
  });

  it("a Send Back: its Stage and who it goes back to, with no code", () => {
    expect(actionSheetEffects({ transitionKey: "send_back", definition, stages, goesTo: tmc, code: null, offersRevision: false, comments: null })).toEqual([
      { kind: "stage", name: bi("Draft") },
      { kind: "told", company: tmc },
    ]);
  });

  it("names nobody when it stays inside the viewer's own Company, and leaves out a Stage it can't find", () => {
    expect(actionSheetEffects({ transitionKey: "unknown", definition, stages, goesTo: null, code: null, offersRevision: false, comments: null })).toEqual([]);
    expect(actionSheetEffects({ transitionKey: "approve_a", definition: null, stages: [], goesTo: null, code: "A", offersRevision: false, comments: null })).toEqual([{ kind: "record", code: "A" }]);
  });
});
