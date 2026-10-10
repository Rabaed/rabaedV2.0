import type { StageCategory, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import { describe, expect, it } from "vitest";
import { sameInBoth as name } from "../../storybook/workflow.ts";
import { bandAt, placedLayout, workflowMap, type MapNode } from "./workflow-map.ts";

const step = (key: string, stage: string, role: "contractor" | "consultant" | null): WorkflowStep => ({
  key,
  name: name(key),
  stage,
  actor: role ? { role, permission: "review" } : null,
  outcomeMode: "none",
});
const transition = (key: string, from: string, to: string, kind: WorkflowTransition["kind"], outcome: string | null = null): WorkflowTransition => ({
  key,
  label: name(key),
  kind,
  from,
  to,
  outcome,
  permission: "approve",
  actionForm: null,
});
const stage = (key: string, category: StageCategory) => ({ key, name: name(key), category });

const stages = [
  stage("draft", "draft"),
  stage("internal_review", "in_progress"),
  stage("pending_approval", "in_progress"),
  stage("unused", "in_progress"),
  stage("approved", "closed_positive"),
  stage("revise_resubmit", "closed_negative"),
  stage("cancelled", "cancelled"),
];

// Draft → Contractor review → Consultant engineer → manager (Return to engineer) → Approved / Revise; Cancel from Draft.
const mar: WorkflowDefinition = {
  steps: [
    step("draft", "draft", "contractor"),
    step("internal_review", "internal_review", "contractor"),
    step("consultant_engineer", "pending_approval", "consultant"),
    step("consultant_manager", "pending_approval", "consultant"),
    step("approved", "approved", null),
    step("revise", "revise_resubmit", null),
    step("cancelled", "cancelled", null),
  ],
  transitions: [
    transition("send", "draft", "internal_review", "send"),
    transition("return", "internal_review", "draft", "return"),
    transition("submit", "internal_review", "consultant_engineer", "submit"),
    transition("to_manager", "consultant_engineer", "consultant_manager", "send"),
    transition("back", "consultant_manager", "consultant_engineer", "return"),
    transition("approve_a", "consultant_manager", "approved", "close", "A"),
    transition("approve_b", "consultant_manager", "approved", "close", "B"),
    transition("revise_c", "consultant_manager", "revise", "close", "C"),
    transition("cancel", "draft", "cancelled", "cancel"),
  ],
  layout: {},
};

const byKey = (nodes: MapNode[], key: string) => nodes.find((n) => n.id === key)!;
const inside = (n: MapNode, band: { x: number; width: number }) => n.x >= band.x && n.x + n.width <= band.x + band.width;

describe("workflowMap: layout", () => {
  const map = workflowMap({ definition: mar, stages, dir: "ltr" });

  it("draws a band per open Stage that has a Step, in the Stages' order, then one Outcome band", () => {
    expect(map.bands.map((b) => b.key)).toEqual(["draft", "internal_review", "pending_approval", "outcome"]);
    for (let i = 1; i < map.bands.length; i++) expect(map.bands[i]!.x).toBe(map.bands[i - 1]!.x + map.bands[i - 1]!.width);
  });

  it("puts each Step in its Stage's band, and the terminal Steps in the Outcome band", () => {
    const band = (key: string) => map.bands.find((b) => b.key === key)!;
    expect(inside(byKey(map.nodes, "draft"), band("draft"))).toBe(true);
    expect(inside(byKey(map.nodes, "consultant_engineer"), band("pending_approval"))).toBe(true);
    expect(inside(byKey(map.nodes, "consultant_manager"), band("pending_approval"))).toBe(true);
    for (const end of ["approved", "revise", "cancelled"]) {
      expect(byKey(map.nodes, end).kind).toBe("end");
      expect(inside(byKey(map.nodes, end), band("outcome"))).toBe(true);
    }
  });

  it("places a later Step of one band after the earlier one, never on top of it", () => {
    expect(byKey(map.nodes, "consultant_manager").x).toBeGreaterThan(byKey(map.nodes, "consultant_engineer").x);
  });

  it("keeps a saved layout when it places every Step", () => {
    const layout = Object.fromEntries(mar.steps.map((s, i) => [s.key, { x: 40 + i * 300, y: 60 }]));
    const saved = workflowMap({ definition: { ...mar, layout }, stages, dir: "ltr" });
    expect(byKey(saved.nodes, "consultant_manager")).toMatchObject({ x: 940, y: 60 });
  });

  it("mirrors everything in Arabic: the flow runs right to left", () => {
    const rtl = workflowMap({ definition: mar, stages, dir: "rtl" });
    expect(rtl.width).toBe(map.width);
    for (const n of map.nodes) expect(byKey(rtl.nodes, n.id).x).toBe(map.width - n.x - n.width);
    expect(rtl.bands.find((b) => b.key === "draft")!.x).toBeGreaterThan(rtl.bands.find((b) => b.key === "outcome")!.x);
  });

  it("gives every Transition an edge between its Steps, a Return running backwards", () => {
    expect(map.edges.map((e) => e.id).toSorted()).toEqual(mar.transitions.map((t) => t.key).toSorted());
    expect(map.edges.find((e) => e.id === "return")).toMatchObject({ source: "internal_review", target: "draft", backwards: true });
    expect(map.edges.find((e) => e.id === "submit")).toMatchObject({ backwards: false });
  });

  it("marks nothing without a position", () => {
    expect(map.nodes.some((n) => n.current)).toBe(false);
  });
});

describe("workflowMap: the builder (RP-439)", () => {
  it("draws a band for every open Stage, an empty one too, so a Step can be dropped into it", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", everyStage: true });
    expect(map.bands.map((b) => b.key)).toEqual(["draft", "internal_review", "pending_approval", "unused", "outcome"]);
  });

  it("tells which band a point on the canvas falls in, in Arabic too", () => {
    for (const dir of ["ltr", "rtl"] as const) {
      const map = workflowMap({ definition: mar, stages, dir, everyStage: true });
      const unused = map.bands.find((b) => b.key === "unused")!;
      expect(bandAt(map, unused.x + 10)?.key).toBe("unused");
    }
    expect(bandAt(workflowMap({ definition: mar, stages, dir: "ltr" }), -50)).toBeNull();
  });

  it("pins the drawn places as a layout that places every Step, so the builder can move one", () => {
    const layout = placedLayout(mar, stages);
    expect(Object.keys(layout).toSorted()).toEqual(mar.steps.map((s) => s.key).toSorted());
    const drawn = workflowMap({ definition: mar, stages, dir: "ltr" });
    const pinned = workflowMap({ definition: { ...mar, layout }, stages, dir: "ltr" });
    for (const n of drawn.nodes) expect(byKey(pinned.nodes, n.id)).toMatchObject({ x: n.x, y: n.y });
  });

  it("keeps a layout that already places every Step", () => {
    const layout = Object.fromEntries(mar.steps.map((s, i) => [s.key, { x: i * 10, y: 5 }]));
    expect(placedLayout({ ...mar, layout }, stages)).toBe(layout);
  });
});

describe("workflowMap: an item's map, as the viewer may know it (V14)", () => {
  it("shows the viewer's own Participant's Steps one by one, and folds each other role's into one part", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "contractor", position: null });
    expect(map.nodes.map((n) => n.id)).not.toContain("consultant_engineer");
    expect(map.nodes.map((n) => n.id)).not.toContain("consultant_manager");
    const group = byKey(map.nodes, "role:consultant");
    expect(group).toMatchObject({ kind: "group", role: "consultant", stepKeys: ["consultant_engineer", "consultant_manager"] });
    // The Submit enters the part; nothing inside it, and nothing leaving it, is drawn.
    expect(map.edges.find((e) => e.id === "submit")).toMatchObject({ target: "role:consultant" });
    for (const hidden of ["to_manager", "back", "approve_a", "revise_c"]) expect(map.edges.map((e) => e.id)).not.toContain(hidden);
    // The viewer's own Steps and the outcomes stay.
    expect(byKey(map.nodes, "internal_review").kind).toBe("step");
    expect(byKey(map.nodes, "approved").kind).toBe("end");
  });

  it("draws how the item reaches the viewer's own Steps from another role's part", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "consultant", position: null });
    expect(map.edges.find((e) => e.id === "submit")).toMatchObject({ source: "role:contractor", target: "consultant_engineer" });
    for (const hidden of ["send", "return", "cancel"]) expect(map.edges.map((e) => e.id)).not.toContain(hidden);
  });

  it("marks the viewer's own current Step", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "contractor", position: { kind: "own", stepKey: "internal_review" } });
    expect(map.nodes.filter((n) => n.current).map((n) => n.id)).toEqual(["internal_review"]);
  });

  it("marks another Participant's whole part, with its Company, and none of its Steps", () => {
    const companyName = name("Design Consultants LLC");
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "contractor", position: { kind: "company", role: "consultant", companyName } });
    expect(map.nodes.filter((n) => n.current)).toEqual([expect.objectContaining({ id: "role:consultant", companyName })]);
  });

  it("folds the viewer's own role too when another Participant of that role holds the item", () => {
    const companyName = name("Beta Build");
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "contractor", position: { kind: "company", role: "contractor", companyName } });
    expect(map.nodes.filter((n) => n.kind === "step")).toEqual([]);
    expect(map.nodes.filter((n) => n.current)).toEqual([expect.objectContaining({ id: "role:contractor", companyName })]);
  });

  it("marks the terminal Step a closed item reached", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: "consultant", position: { kind: "closed", stepKey: "approved" } });
    expect(map.nodes.filter((n) => n.current).map((n) => n.id)).toEqual(["approved"]);
  });

  it("folds every role for a viewer with none on the Project", () => {
    const map = workflowMap({ definition: mar, stages, dir: "ltr", viewerRole: null, position: null });
    expect(map.nodes.filter((n) => n.kind === "group").map((n) => n.id)).toEqual(["role:contractor", "role:consultant"]);
    expect(map.nodes.filter((n) => n.kind === "step")).toEqual([]);
  });
});
