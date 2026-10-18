import { actorHolder, actorRole, type BaseRole, type BilingualText, type StageCategory, type WorkItemMapPosition, type WorkflowDefinition, type WorkflowStep, type WorkflowTransition } from "@rabaed/domain";
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
  /** The builder (RP-439): a band for every open Stage, an empty one too, to drop a Step into. */
  everyStage?: boolean;
  /**
   * The builder's bands as they stood (left-to-right units): kept while every Step still sits in its
   * own Stage's band, so dropping a Step near a boundary never moves the bands (RP-555 review).
   */
  fixedBands?: readonly MapBand[];
};

const STEP_WIDTH = 200;
/** A Step card's least height, as the reference builder's (RP-555); a long name makes it taller. */
const STEP_HEIGHT = 78;
const END_WIDTH = 170;
const END_HEIGHT = 46;
const LANE = 310; // One column of Steps in a band: room between cards for a Transition's label.
const TOP = 56; // Room for the band's name.
const ROW = STEP_HEIGHT + 48;
const MIN_HEIGHT = 520;
const GROUP_PAD = 10;

const closed = new Set<StageCategory>(["closed_positive", "closed_negative", "cancelled"]);
const forward = new Set<WorkflowTransition["kind"]>(["send", "submit", "close", "cancel"]);

/** Bands, nodes and edges of a Workflow on the canvas. */
export function workflowMap({ definition, stages, dir, viewerRole, position, everyStage = false, fixedBands }: WorkflowMapInput): WorkflowMapModel {
  const stageOf = new Map(stages.map((s) => [s.key, s]));
  const terminal = isTerminal(stageOf);
  const colourOf = (s: WorkflowStep): StageKey => {
    const stage = stageOf.get(s.stage);
    return stage ? stageColour(stage) : terminal(s) ? "approved" : "pending";
  };

  const keys = bandKeys(definition, stages, terminal, everyStage);
  const { boxes, bands, width, height } = placesEvery(definition) ? savedLayout(definition, keys, stages, terminal, fixedBands) : autoLayout(definition, keys, stages, terminal);

  // Fold the other roles' Steps, in the order the Workflow first names each role.
  const folded = new Map<string, BaseRole>();
  const groups: MapNode[] = [];
  if (viewerRole !== undefined) {
    // A Step held by the raiser folds only once the item's map names its role (withRaiserRole, RP-622).
    const roles = [...new Set(definition.steps.filter((s) => !terminal(s)).flatMap((s) => actorRole(s.actor) ?? []))];
    // Another Participant of the viewer's own role holding the item (a second Contractor's) is folded too.
    const held = position?.kind === "company" ? position.role : null;
    for (const role of roles.filter((r) => r !== viewerRole || r === held)) {
      const steps = definition.steps.filter((s) => actorRole(s.actor) === role && !terminal(s));
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

/** The band a point at `x` on the canvas (in the model's own direction) falls in; null outside every band. */
export function bandAt(model: WorkflowMapModel, x: number): MapBand | null {
  return model.bands.find((b) => x >= b.x && x < b.x + b.width) ?? null;
}

/**
 * A layout placing every Step where the canvas draws it now, in left-to-right units: the
 * builder pins it before the first move, as a layout counts only when it places every
 * Step (the Rabaed Defaults have none). A layout that already does is kept as it is.
 */
export function placedLayout(definition: WorkflowDefinition, stages: readonly MapStage[], everyStage = false): WorkflowDefinition["layout"] {
  if (placesEvery(definition)) return definition.layout;
  const terminal = isTerminal(new Map(stages.map((s) => [s.key, s])));
  const { boxes } = autoLayout(definition, bandKeys(definition, stages, terminal, everyStage), stages, terminal);
  return Object.fromEntries([...boxes].map(([key, b]) => [key, { x: b.x, y: b.y }]));
}

const placesEvery = (definition: WorkflowDefinition) => definition.steps.length > 0 && definition.steps.every((s) => definition.layout[s.key]);

const isTerminal = (stageOf: ReadonlyMap<string, MapStage>) => (s: WorkflowStep) => s.actor === null || closed.has(stageOf.get(s.stage)?.category ?? "in_progress");

type Layout = { boxes: Map<string, Omit<Box, "id" | "current">>; bands: MapBand[]; width: number; height: number };

const size = (isTerminal: boolean) => (isTerminal ? { width: END_WIDTH, height: END_HEIGHT } : { width: STEP_WIDTH, height: STEP_HEIGHT });

/**
 * The open Stages that hold a Step, in order (a Stage the set lacks goes last, by its key);
 * every open Stage of the set with `everyStage`. The Outcome band follows them.
 */
function bandKeys(definition: WorkflowDefinition, stages: readonly MapStage[], terminal: (s: WorkflowStep) => boolean, everyStage: boolean) {
  const used = new Set(definition.steps.filter((s) => !terminal(s)).map((s) => s.stage));
  const known = stages.filter((s) => used.has(s.key) || (everyStage && !closed.has(s.category))).map((s) => s.key);
  const unknown = [...used].filter((k) => !stages.some((s) => s.key === k));
  return [...known, ...unknown];
}

function band(key: string, stages: readonly MapStage[], x: number, width: number): MapBand {
  const stage = stages.find((s) => s.key === key);
  return { key, name: stage?.name ?? null, colour: stage ? stageColour(stage) : null, x, width };
}

const outcomeBand = (x: number, width: number): MapBand => ({ key: "outcome", name: null, colour: "approved", x, width });

function autoLayout(definition: WorkflowDefinition, keys: readonly string[], stages: readonly MapStage[], terminal: (s: WorkflowStep) => boolean): Layout {
  // How far along the flow each Step is: its distance from the Draft over forward Transitions.
  const depth = new Map<string, number>();
  const start = definition.steps.find((s) => stages.find((st) => st.key === s.stage)?.category === "draft") ?? definition.steps[0];
  if (start) depth.set(start.key, 0);
  for (let frontier = start ? [start.key] : []; frontier.length > 0; ) {
    const from = frontier.shift()!;
    for (const t of definition.transitions) {
      if (t.from === from && forward.has(t.kind) && !depth.has(t.to)) {
        depth.set(t.to, depth.get(from)! + 1);
        frontier.push(t.to);
      }
    }
  }

  const boxes: Layout["boxes"] = new Map();
  const bands: MapBand[] = [];
  const lanes: { x: number; steps: WorkflowStep[] }[] = [];
  let x = 0;
  for (const key of keys) {
    const inBand = definition.steps.filter((s) => s.stage === key && !terminal(s));
    const depths = [...new Set(inBand.map((s) => depth.get(s.key) ?? Number.MAX_SAFE_INTEGER))].toSorted((a, b) => a - b);
    if (depths.length === 0) {
      // An empty band (the builder's): one column wide, to drop a Step into.
      bands.push(band(key, stages, x, LANE));
      x += LANE;
      continue;
    }
    depths.forEach((d, i) =>
      lanes.push({
        x: x + i * LANE + (LANE - STEP_WIDTH) / 2,
        // One role's Steps together, so a folded part covers only its own.
        steps: inBand.filter((s) => (depth.get(s.key) ?? Number.MAX_SAFE_INTEGER) === d).toSorted((a, b) => (actorHolder(a.actor) ?? "").localeCompare(actorHolder(b.actor) ?? "")),
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

/**
 * Bands around Steps placed by hand: a band ends halfway between its last Step and the next
 * band's first (as the reference builder draws them, RP-555), or past its last Step when the
 * next one starts before that; an empty band is one column wide.
 */
function savedLayout(
  definition: WorkflowDefinition,
  keys: readonly string[],
  stages: readonly MapStage[],
  terminal: (s: WorkflowStep) => boolean,
  fixed?: readonly MapBand[],
): Layout {
  const boxes: Layout["boxes"] = new Map(definition.steps.map((s) => [s.key, { ...definition.layout[s.key]!, ...size(terminal(s)) }]));
  const bottom = Math.max(...[...boxes.values()].map((b) => b.y + b.height));
  // The bands as they stood, while each Step's centre is still in its own Stage's band (the last one stretched to its Steps).
  if (fixed && fixed.length === keys.length + 1 && keys.every((k, i) => fixed[i]!.key === k)) {
    const kept = fixed.map((b, i) => {
      if (i < fixed.length - 1) return b;
      const right = Math.max(b.x + b.width, ...definition.steps.filter(terminal).map((st) => boxes.get(st.key)!.x + boxes.get(st.key)!.width + 40));
      return { ...b, width: right - b.x };
    });
    const fits = definition.steps.every((st) => {
      const b = boxes.get(st.key)!;
      const band = kept[terminal(st) ? kept.length - 1 : keys.indexOf(st.stage)];
      const centre = b.x + b.width / 2;
      return band !== undefined && centre >= band.x && centre < band.x + band.width;
    });
    if (fits) {
      const last = kept.at(-1)!;
      return { boxes, bands: kept, width: last.x + last.width, height: Math.max(MIN_HEIGHT, bottom + 40) };
    }
  }
  const groups = [...keys.map((key) => definition.steps.filter((s) => s.stage === key && !terminal(s))), definition.steps.filter(terminal)];
  const left = (steps: WorkflowStep[]) => Math.min(...steps.map((s) => boxes.get(s.key)!.x));
  const right = (steps: WorkflowStep[]) => Math.max(...steps.map((s) => boxes.get(s.key)!.x + boxes.get(s.key)!.width));
  const bands: MapBand[] = [];
  let x = 0;
  groups.forEach((steps, i) => {
    const last = i === groups.length - 1;
    const next = groups.slice(i + 1).find((g) => g.length > 0);
    let end: number;
    if (steps.length === 0) {
      // An empty band takes at most a column, and stops short of the next Steps (shared with the empty ones beside it).
      const empties = groups.slice(i).findIndex((g) => g.length > 0);
      const room = next ? (left(next) - 20 - x) / Math.max(1, empties) : LANE;
      end = x + Math.max(120, Math.min(LANE, room));
    } else if (last || !next) end = Math.max(x + LANE / 2, right(steps) + 40);
    else if (groups[i + 1]!.length === 0) end = Math.max(x + LANE / 2, right(steps) + 20);
    else end = Math.max(x + LANE / 2, right(steps) + 20, Math.round((right(steps) + left(next)) / 20) * 10);
    bands.push(last ? outcomeBand(x, end - x) : band(keys[i]!, stages, x, end - x));
    x = end;
  });
  const end = x;
  return { boxes, bands, width: end, height: Math.max(MIN_HEIGHT, bottom + 40) };
}

/**
 * Auto-layout (RP-555, the reference's): each Step in its Stage's band, a column per step of the
 * route from the Draft Step (Returns, Send Backs and Cancels don't count), the Steps of one column
 * stacked around the middle, and the Ends in a column after the last band. Left-to-right units.
 */
export function arrangedLayout(definition: WorkflowDefinition, stages: readonly MapStage[], everyStage = true): WorkflowDefinition["layout"] {
  const terminal = isTerminal(new Map(stages.map((st) => [st.key, st])));
  const keys = bandKeys(definition, stages, terminal, everyStage);
  const backwards = new Set<WorkflowTransition["kind"]>(["return", "send_back", "cancel"]);
  const depth = new Map<string, number>();
  const start = definition.steps.find((st) => stages.find((x) => x.key === st.stage)?.category === "draft" && !terminal(st)) ?? definition.steps[0];
  if (start) depth.set(start.key, 0);
  for (let frontier = start ? [start.key] : []; frontier.length > 0; ) {
    const from = frontier.shift()!;
    for (const t of definition.transitions) {
      const to = definition.steps.find((st) => st.key === t.to);
      if (t.from !== from || backwards.has(t.kind) || !to || terminal(to) || depth.has(t.to)) continue;
      depth.set(t.to, depth.get(from)! + 1);
      frontier.push(t.to);
    }
  }
  const COLUMN = 260;
  const MIDDLE = 330;
  const layout: WorkflowDefinition["layout"] = {};
  let x = 0;
  for (const key of keys) {
    const inBand = definition.steps.filter((st) => st.stage === key && !terminal(st));
    const depths = [...new Set(inBand.map((st) => depth.get(st.key) ?? 99))].toSorted((a, b) => a - b);
    if (depths.length === 0) {
      x += 250;
      continue;
    }
    const x0 = x + 25;
    depths.forEach((d, i) => {
      const column = inBand.filter((st) => (depth.get(st.key) ?? 99) === d);
      column.forEach((st, j) => {
        layout[st.key] = { x: x0 + i * COLUMN, y: Math.round((MIDDLE - (column.length - 1) * 145 + j * 290 - STEP_HEIGHT / 2) / 10) * 10 };
      });
    });
    x = x0 + (depths.length - 1) * COLUMN + STEP_WIDTH + 25;
  }
  definition.steps.filter(terminal).forEach((st, j) => {
    layout[st.key] = { x: x + 40, y: 70 + j * 160 };
  });
  return layout;
}

/** In Arabic the flow runs right to left: every x is mirrored. */
function mirrored(model: WorkflowMapModel, dir: Direction): WorkflowMapModel {
  if (dir === "ltr") return model;
  const flip = <T extends { x: number; width: number }>(b: T): T => ({ ...b, x: model.width - b.x - b.width });
  return { ...model, bands: model.bands.map(flip), nodes: model.nodes.map(flip) };
}
