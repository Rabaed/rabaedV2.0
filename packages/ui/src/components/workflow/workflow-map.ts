import type { BaseRole, BilingualText, StageCategory, WorkItemMapPosition, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "@rabaed/domain";
import type { StageKey } from "../../tokens/themes.ts";
import { stageColour } from "../status/stage-colour.ts";

// The Workflow canvas's model (RP-438, WF-15; workflow-engine.md §11): where each
// band, Step and Transition goes, worked out apart from React Flow so it can be
// tested. Stages are bands side by side, in the Stages' order (the flow runs left
// to right, right to left in Arabic), with one Outcome band for the terminal
// Steps, as in the design's canvas. A saved layout places the Steps when it places
// every one of them; otherwise (the Rabaed Defaults have none) each Step sits in its
// Stage's band, a later Step of the same band beside the earlier one.
//
// An item's map (`viewerRole` given) folds every other Participant role's Steps
// into one part, and draws nothing inside it, nor from it but into one of the
// viewer's own Steps (how the item reaches them): the viewer learns
// where the item is only as the API's position says (V14), so another
// Participant's part is marked as a whole, never one of its Steps.

type Direction = "ltr" | "rtl";

export type MapStage ={ key: string; name: BilingualText; category: StageCategory };

export type MapBand = { key: string; name: BilingualText | null; colour: StageKey | null; x: number; width: number };

type Box = { id: string; x: number; y: number; width: number; height: number; current: boolean };

export type MapNode =
  | (Box & { kind: "step"; step: WorkflowStep; colour: StageKey })
  | (Box & { kind: "end"; step: WorkflowStep; colour: StageKey })
  | (Box & {
      kind: "group";
      role: BaseRole;
      stepKeys: string[];
      /** The Stages its Steps are in, by key, each once. */
      stepStages: string[];
      colour: StageKey;
      /** Only on the part holding the item: its Company, as the API names it. */
      companyName: BilingualText | null;
    });

export type MapEdge = {
  id: string;
  transition: WorkflowTransition;
  source: string;
  target: string;
  /** Runs against the flow (a Return, a Send Back, or to an earlier band): drawn below the Steps. */
  backwards: boolean;
  /** Between two Steps of one column: drawn straight down or up. */
  vertical: boolean;
  /** The colour of the terminal Step it closes into, if it does. */
  targetColour: StageKey | null;
};

export type WorkflowMapModel = { width: number; height: number; bands: MapBand[]; nodes: MapNode[]; edges: MapEdge[] };

export type WorkflowMapInput = {
  definition: WorkflowDefinition;
  /** The Stages of the Project and Module, in their order. */
  stages: readonly MapStage[];
  dir: Direction;
  /**
   * An item's map: the viewer's own Participant role (null for a reader with
   * none). Every other role's Steps fold into one part. Leave out for the whole
   * Workflow, as its authors see it.
   */
  viewerRole?: BaseRole | null;
  /** Where the item is, as the API gives it. */
  position?: WorkItemMapPosition | null;
};

export const STEP_WIDTH = 200;
export const STEP_HEIGHT = 92;
export const END_WIDTH = 170;
export const END_HEIGHT = 46;
const LANE = 310; // One column of Steps in a band: room between cards for a Transition's label.
const TOP = 56; // Room for the band's name.
const ROW = STEP_HEIGHT + 48;
const MIN_HEIGHT = 520;
const GROUP_PAD = 10;

const closed = new Set<StageCategory>(["closed_positive", "closed_negative", "cancelled"]);
const forward = new Set<WorkflowTransition["kind"]>(["send", "submit", "close", "cancel"]);

/** Bands, nodes and edges of a Workflow on the canvas. */
export function workflowMap({ definition, stages, dir, viewerRole, position }: WorkflowMapInput): WorkflowMapModel {
  const stageOf = new Map(stages.map((s) => [s.key, s]));
  const terminal = (s: WorkflowStep) => s.actor === null || closed.has(stageOf.get(s.stage)?.category ?? "in_progress");
  const colourOf = (s: WorkflowStep): StageKey => {
    const stage = stageOf.get(s.stage);
    return stage ? stageColour(stage) : terminal(s) ? "approved" : "pending";
  };

  const saved = definition.steps.length > 0 && definition.steps.every((s) => definition.layout[s.key]);
  const { boxes, bands, width, height } = saved ? savedLayout(definition, stages, terminal) : autoLayout(definition, stages, terminal);

  // Fold the other roles' Steps, in the order the Workflow first names each role.
  const folded = new Map<string, BaseRole>();
  const groups: MapNode[] = [];
  if (viewerRole !== undefined) {
    const roles = [...new Set(definition.steps.flatMap((s) => (s.actor && !terminal(s) ? [s.actor.role] : [])))];
    for (const role of roles.filter((r) => r !== viewerRole)) {
      const steps = definition.steps.filter((s) => s.actor?.role === role && !terminal(s));
      const own = steps.map((s) => boxes.get(s.key)!);
      const x = Math.min(...own.map((b) => b.x)) - GROUP_PAD;
      const y = Math.min(...own.map((b) => b.y)) - GROUP_PAD;
      const current = position?.kind === "company" && position.role === role;
      for (const s of steps) folded.set(s.key, role);
      groups.push({
        id: `role:${role}`,
        kind: "group",
        role,
        stepKeys: steps.map((s) => s.key),
        stepStages: [...new Set(steps.map((s) => s.stage))],
        colour: colourOf(steps[0]!),
        companyName: current ? position.companyName : null,
        x,
        y,
        width: Math.max(...own.map((b) => b.x + b.width)) + GROUP_PAD - x,
        height: Math.max(...own.map((b) => b.y + b.height)) + GROUP_PAD - y,
        current,
      });
    }
  }
  const currentStep = position && position.kind !== "company" ? position.stepKey : null;
  const nodes: MapNode[] = [
    ...groups,
    ...definition.steps
      .filter((s) => !folded.has(s.key))
      .map((s): MapNode => ({ ...boxes.get(s.key)!, id: s.key, kind: terminal(s) ? "end" : "step", step: s, colour: colourOf(s), current: s.key === currentStep })),
  ];

  const nodeId = (stepKey: string) => (folded.has(stepKey) ? `role:${folded.get(stepKey)}` : stepKey);
  const box = new Map(nodes.map((n) => [n.id, n]));
  const steps = new Map(definition.steps.map((s) => [s.key, s]));
  const edges = definition.transitions.flatMap((t): MapEdge[] => {
    const source = box.get(nodeId(t.from));
    const target = box.get(nodeId(t.to));
    // From another Participant's part, only how the item reaches one of the viewer's own Steps:
    // nothing inside the part, or from it to another part or an outcome.
    if (!source || !target || (source.kind === "group" && target.kind !== "step")) return [];
    const dx = target.x + target.width / 2 - (source.x + source.width / 2);
    const to = steps.get(t.to);
    return [
      {
        id: t.key,
        transition: t,
        source: source.id,
        target: target.id,
        backwards: !forward.has(t.kind) || dx < -5,
        vertical: Math.abs(dx) < 5,
        targetColour: to && terminal(to) ? colourOf(to) : null,
      },
    ];
  });

  return mirrored({ width, height, bands, nodes, edges }, dir);
}

type Layout = { boxes: Map<string, Omit<Box, "id" | "current">>; bands: MapBand[]; width: number; height: number };

const size = (isTerminal: boolean) => (isTerminal ? { width: END_WIDTH, height: END_HEIGHT } : { width: STEP_WIDTH, height: STEP_HEIGHT });

/** The open Stages that hold a Step, in order (a Stage the set lacks goes last, by its key), then the Outcome band. */
function bandKeys(definition: WorkflowDefinition, stages: readonly MapStage[], terminal: (s: WorkflowStep) => boolean) {
  const used = new Set(definition.steps.filter((s) => !terminal(s)).map((s) => s.stage));
  const known = stages.filter((s) => used.has(s.key)).map((s) => s.key);
  const unknown = [...used].filter((k) => !stages.some((s) => s.key === k));
  return [...known, ...unknown];
}

function band(key: string, stages: readonly MapStage[], x: number, width: number): MapBand {
  const stage = stages.find((s) => s.key === key);
  return { key, name: stage?.name ?? null, colour: stage ? stageColour(stage) : null, x, width };
}

const outcomeBand = (x: number, width: number): MapBand => ({ key: "outcome", name: null, colour: "approved", x, width });

function autoLayout(definition: WorkflowDefinition, stages: readonly MapStage[], terminal: (s: WorkflowStep) => boolean): Layout {
  // How far along the flow each Step is: its distance from the Draft over forward Transitions.
  const depth = new Map<string, number>();
  const start = definition.steps.find((s) => stages.find((st) => st.key === s.stage)?.category === "draft") ?? definition.steps[0];
  if (start) depth.set(start.key, 0);
  for (let queue = start ? [start.key] : []; queue.length > 0; ) {
    const from = queue.shift()!;
    for (const t of definition.transitions) {
      if (t.from === from && forward.has(t.kind) && !depth.has(t.to)) {
        depth.set(t.to, depth.get(from)! + 1);
        queue.push(t.to);
      }
    }
  }

  const boxes: Layout["boxes"] = new Map();
  const bands: MapBand[] = [];
  const lanes: { x: number; steps: WorkflowStep[] }[] = [];
  let x = 0;
  for (const key of bandKeys(definition, stages, terminal)) {
    const inBand = definition.steps.filter((s) => s.stage === key && !terminal(s));
    const depths = [...new Set(inBand.map((s) => depth.get(s.key) ?? Number.MAX_SAFE_INTEGER))].toSorted((a, b) => a - b);
    depths.forEach((d, i) =>
      lanes.push({
        x: x + i * LANE + (LANE - STEP_WIDTH) / 2,
        // One role's Steps together, so a folded part covers only its own.
        steps: inBand.filter((s) => (depth.get(s.key) ?? Number.MAX_SAFE_INTEGER) === d).toSorted((a, b) => (a.actor?.role ?? "").localeCompare(b.actor?.role ?? "")),
      }),
    );
    bands.push(band(key, stages, x, depths.length * LANE));
    x += depths.length * LANE;
  }
  const ends = definition.steps.filter(terminal);
  const rows = Math.max(1, ...lanes.map((l) => l.steps.length));
  const height = Math.max(MIN_HEIGHT, TOP + rows * ROW + 40, TOP + ends.length * (END_HEIGHT + 40) + 40);
  const top = TOP + (height - TOP - rows * ROW) / 2 + (ROW - STEP_HEIGHT) / 2;
  for (const lane of lanes) lane.steps.forEach((s, row) => boxes.set(s.key, { x: lane.x, y: top + row * ROW, ...size(false) }));

  const gap = (height - TOP) / Math.max(1, ends.length);
  ends.forEach((s, i) => boxes.set(s.key, { x: x + (LANE - END_WIDTH) / 2, y: TOP + gap * i + (gap - END_HEIGHT) / 2, ...size(true) }));
  bands.push(outcomeBand(x, LANE));
  return { boxes, bands, width: x + LANE, height };
}

function savedLayout(definition: WorkflowDefinition, stages: readonly MapStage[], terminal: (s: WorkflowStep) => boolean): Layout {
  const boxes: Layout["boxes"] = new Map(definition.steps.map((s) => [s.key, { ...definition.layout[s.key]!, ...size(terminal(s)) }]));
  const bands: MapBand[] = [];
  let x = 0;
  const right = (steps: WorkflowStep[]) => Math.max(x, ...steps.map((s) => boxes.get(s.key)!.x + boxes.get(s.key)!.width));
  for (const key of bandKeys(definition, stages, terminal)) {
    const end = Math.max(x + LANE, right(definition.steps.filter((s) => s.stage === key && !terminal(s))) + 30);
    bands.push(band(key, stages, x, end - x));
    x = end;
  }
  const end = Math.max(x + LANE, right(definition.steps.filter(terminal)) + 30);
  bands.push(outcomeBand(x, end - x));
  const bottom = Math.max(...[...boxes.values()].map((b) => b.y + b.height));
  return { boxes, bands, width: end, height: Math.max(MIN_HEIGHT, bottom + 40) };
}

/** In Arabic the flow runs right to left: every x is mirrored. */
function mirrored(model: WorkflowMapModel, dir: Direction): WorkflowMapModel {
  if (dir === "ltr") return model;
  const flip = <T extends { x: number; width: number }>(b: T): T => ({ ...b, x: model.width - b.x - b.width });
  return { ...model, bands: model.bands.map(flip), nodes: model.nodes.map(flip) };
}
