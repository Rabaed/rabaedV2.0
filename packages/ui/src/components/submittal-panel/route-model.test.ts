import type { WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalOwnerWorkflow as definition } from "../../storybook/submittal-route.ts";
import { workflowStages as stages, sameInBoth as name } from "../../storybook/workflow.ts";
import { routeStopLine, submittalRoute, submittalRouteStopLine } from "./route-model.ts";

const route = (position: Parameters<typeof submittalRoute>[0]["position"]) => submittalRoute({ definition, stages, position });
const states = (r: ReturnType<typeof submittalRoute>) => r.stops.map((s) => `${s.role}:${s.state}`);

describe("the route strip's stops (RP-1064, README §4.4)", () => {
  it("runs by Project Role, each Company's Steps one stop, back to the raiser for the outcome", () => {
    const r = route(null);
    expect(r.stops.map((s) => s.role)).toEqual(["contractor", "consultant", "owner", "contractor"]);
    expect(r.stops.map((s) => s.stepKeys)).toEqual([
      ["draft", "internal_review", "contractor_engineer"],
      ["consultant_engineer", "consultant_manager"],
      ["owner_review"],
      [],
    ]);
  });

  it("marks where the viewer's own Participant holds it: its stop current, earlier done, later upcoming", () => {
    const r = route({ kind: "own", stepKey: "internal_review" });
    expect(states(r)).toEqual(["contractor:current", "consultant:upcoming", "owner:upcoming", "contractor:upcoming"]);
  });

  it("finds a Step reached only by a Return in its own Company's stop", () => {
    const r = route({ kind: "own", stepKey: "contractor_engineer" });
    expect(states(r)[0]).toBe("contractor:current");
  });

  it("marks another Company's stop as a whole, by role, with the Company the API names", () => {
    const r = route({ kind: "company", role: "consultant", companyName: name("Design Consultants LLC") });
    expect(states(r)).toEqual(["contractor:done", "consultant:current", "owner:upcoming", "contractor:upcoming"]);
    expect(r.stops[1]!.companyName).toEqual(name("Design Consultants LLC"));
    expect(r.stops.filter((s) => s.companyName !== null)).toHaveLength(1);
  });

  it("reads 'Owner review' where the API gives it in the Company's place (ADR 0022)", () => {
    const ownerReview = name("Owner review");
    const r = route({ kind: "company", role: "owner", companyName: ownerReview });
    expect(states(r)).toEqual(["contractor:done", "consultant:done", "owner:current", "contractor:upcoming"]);
    expect(r.stops[2]!.companyName).toEqual(ownerReview);
  });

  it("marks every stop done once closed, the raiser's closing stop too (the design's wf(): nobody holds it)", () => {
    for (const stepKey of ["approved", "rejected"]) {
      const r = route({ kind: "closed", stepKey });
      expect(states(r)).toEqual(["contractor:done", "consultant:done", "owner:done", "contractor:done"]);
      expect(r.stops.every((s) => s.companyName === null)).toBe(true);
    }
  });

  it("keeps a Company's Steps one stop when one of them can also skip ahead (review)", () => {
    // The Consultant's engineer may also send straight to the Owner, listed before the move to its manager.
    const skip: WorkflowTransition = { ...definition.transitions.find((t) => t.key === "send_to_manager")!, key: "skip", kind: "submit", to: "owner_review" };
    const at = definition.transitions.findIndex((t) => t.key === "send_to_manager");
    const skipping = { ...definition, transitions: [...definition.transitions.slice(0, at), skip, ...definition.transitions.slice(at)] };
    const r = submittalRoute({ definition: skipping, stages, position: { kind: "company", role: "consultant", companyName: name("Design Consultants LLC") } });
    expect(r.stops.map((s) => `${s.role}:${s.state}`)).toEqual(["contractor:done", "consultant:current", "owner:upcoming", "contractor:upcoming"]);
  });

  it("marks no stop while the viewer may not know who holds it", () => {
    expect(route(null).stops.every((s) => s.state === "upcoming")).toBe(true);
  });

  it("adds no closing stop when the route already ends with the raiser (a Snag's verify Step)", () => {
    const step = (key: string, role: "contractor" | "consultant" | null): WorkflowStep => ({ key, name: name(key), stage: role ? "internal_review" : "approved", actor: role ? { role, permission: "review" } : null, outcomeMode: "none" });
    const move = (key: string, kind: WorkflowTransition["kind"], from: string, to: string): WorkflowTransition => ({ key, label: name(key), kind, from, to, outcome: null, permission: "review", actionForm: null });
    const snag: WorkflowDefinition = {
      steps: [{ ...step("draft", "consultant"), stage: "draft" }, step("open", "contractor"), step("verify", "consultant"), step("closed", null)],
      transitions: [move("raise", "submit", "draft", "open"), move("fixed", "submit", "open", "verify"), move("close", "close", "verify", "closed"), move("again", "send_back", "verify", "open")],
      layout: {},
    };
    const r = submittalRoute({ definition: snag, stages, position: { kind: "closed", stepKey: "closed" } });
    expect(r.stops.map((s) => `${s.role}:${s.state}`)).toEqual(["consultant:done", "contractor:done", "consultant:done"]);

    // The Contractor, while another Consultant holds it: its role has two stops, and the API names no Step, so neither is marked.
    const held = submittalRoute({ definition: snag, stages, position: { kind: "company", role: "consultant", companyName: name("Design Consultants LLC") } });
    expect(held.stops.every((s) => s.state === "upcoming" && s.companyName === null)).toBe(true);
  });
});

// The rail's vertical Step list (RP-1093, README §4.9): one row per stop, each saying no more than the strip may.
describe("the rail's Step list rows (RP-1093, README §4.9, V14)", () => {
  const lines = (r: ReturnType<typeof submittalRoute>) => r.stops.map((_, i) => submittalRouteStopLine(r, i));

  it("names the viewer's own Step where its Participant holds the item: the positive control", () => {
    const r = route({ kind: "own", stepKey: "internal_review" });
    expect(lines(r)).toEqual([
      // The fixture's "Contractor PM".
      { kind: "step", name: definition.steps.find((s) => s.key === "internal_review")!.name },
      { kind: "steps", count: 2 },
      { kind: "steps", count: 1 },
      { kind: "outcome" },
    ]);
  });

  it("names only the Company the API gives where another Company holds it, never one of its Steps", () => {
    const company = name("Design Consultants LLC");
    const r = route({ kind: "company", role: "consultant", companyName: company });
    expect(lines(r)).toEqual([{ kind: "steps", count: 3 }, { kind: "company", name: company }, { kind: "steps", count: 1 }, { kind: "outcome" }]);
    expect(JSON.stringify(lines(r))).not.toContain("Consultant Engineer");
  });

  it("gives the Workflow map's large strip, from the stop alone, the same line without the viewer's own Step", () => {
    const r = route({ kind: "own", stepKey: "internal_review" });
    expect(r.stops.map((s) => routeStopLine(s))).toEqual([{ kind: "steps", count: 3 }, { kind: "steps", count: 2 }, { kind: "steps", count: 1 }, { kind: "outcome" }]);
  });

  it("names no Step once closed: the raiser's stop receives the outcome", () => {
    expect(lines(route({ kind: "closed", stepKey: "approved" })).map((l) => l.kind)).toEqual(["steps", "steps", "steps", "outcome"]);
  });
});

// Scenario RP-1064-1 (docs/visibility.md): the model draws no more than the map read's position.
describe("the Workflow map's Step cards (RP-1064, README §6, V14 and V20)", () => {
  it("shows every Company's Steps, numbered in route order, each with its Project Role", () => {
    const r = route(null);
    expect(r.steps.map((s) => [s.number, s.step.key, s.role, s.stop])).toEqual([
      [1, "draft", "contractor", 0],
      [2, "internal_review", "contractor", 0],
      [3, "contractor_engineer", "contractor", 0],
      [4, "consultant_engineer", "consultant", 1],
      [5, "consultant_manager", "consultant", 1],
      [6, "owner_review", "owner", 2],
    ]);
  });

  it("says what happens at a Step by the Transitions leaving it, each label once", () => {
    const r = route(null);
    const happens = (key: string) => r.steps.find((s) => s.step.key === key)!.happens.map((l) => l.en);
    expect(happens("owner_review")).toEqual(["Confirm", "Send Back"]);
    expect(happens("draft")).toEqual(["Send for Review", "Cancel"]);
  });

  it("outlines the viewer's own Step: the positive control", () => {
    const r = route({ kind: "own", stepKey: "internal_review" });
    expect(r.steps.filter((s) => s.current).map((s) => s.step.key)).toEqual(["internal_review"]);
  });

  it("never outlines one of another Company's Steps: the item is inside the Consultant (V14)", () => {
    const r = route({ kind: "company", role: "consultant", companyName: name("Design Consultants LLC") });
    expect(r.steps.some((s) => s.current)).toBe(false);
    // The whole Consultant stop holds it instead.
    expect(r.stops.findIndex((s) => s.state === "current")).toBe(1);
  });

  it("outlines no Step once closed", () => {
    expect(route({ kind: "closed", stepKey: "approved" }).steps.some((s) => s.current)).toBe(false);
  });
});
