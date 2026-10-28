import type { WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { submittalOwnerWorkflow as definition } from "../../storybook/submittal-route.ts";
import { workflowStages as stages, sameInBoth as name } from "../../storybook/workflow.ts";
import { submittalRoute } from "./route-model.ts";

const route = (position: Parameters<typeof submittalRoute>[0]["position"]) => submittalRoute({ definition, stages, position });
const states = (r: ReturnType<typeof submittalRoute>) => r.stops.map((s) => `${s.role}:${s.state}`);

describe("the route strip's stops (RP-1064, README §4.4)", () => {
  it("runs by Project Role, each Company's Steps one stop, back to the raiser for the result", () => {
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
    const ownerReview = { en: "Owner review", ar: "مراجعة المالك" };
    const r = route({ kind: "company", role: "owner", companyName: ownerReview });
    expect(states(r)).toEqual(["contractor:done", "consultant:done", "owner:current", "contractor:upcoming"]);
    expect(r.stops[2]!.companyName).toEqual(ownerReview);
  });

  it("ends at the raiser's stop once closed, every stop before it done", () => {
    const r = route({ kind: "closed", stepKey: "rejected" });
    expect(states(r)).toEqual(["contractor:done", "consultant:done", "owner:done", "contractor:current"]);
  });

  it("marks no stop while the viewer may not know who holds it", () => {
    expect(route(null).stops.every((s) => s.state === "upcoming")).toBe(true);
  });

  it("adds no result stop when the route already ends with the raiser (a Snag's verify Step)", () => {
    const step = (key: string, role: "contractor" | "consultant" | null): WorkflowStep => ({ key, name: name(key), stage: role ? "internal_review" : "approved", actor: role ? { role, permission: "review" } : null, outcomeMode: "none" });
    const move = (key: string, kind: WorkflowTransition["kind"], from: string, to: string): WorkflowTransition => ({ key, label: name(key), kind, from, to, outcome: null, permission: "review", actionForm: null });
    const snag: WorkflowDefinition = {
      steps: [{ ...step("draft", "consultant"), stage: "draft" }, step("open", "contractor"), step("verify", "consultant"), step("closed", null)],
      transitions: [move("raise", "submit", "draft", "open"), move("fixed", "submit", "open", "verify"), move("close", "close", "verify", "closed"), move("again", "send_back", "verify", "open")],
      layout: {},
    };
    const r = submittalRoute({ definition: snag, stages, position: { kind: "closed", stepKey: "closed" } });
    expect(r.stops.map((s) => `${s.role}:${s.state}`)).toEqual(["consultant:done", "contractor:done", "consultant:current"]);

    // The Contractor, while another Consultant holds it: its role has two stops, and the API names no Step, so neither is marked.
    const held = submittalRoute({ definition: snag, stages, position: { kind: "company", role: "consultant", companyName: name("Design Consultants LLC") } });
    expect(held.stops.every((s) => s.state === "upcoming" && s.companyName === null)).toBe(true);
  });
});

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
