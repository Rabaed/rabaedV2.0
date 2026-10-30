import {
  actorRole,
  isOpenStageCategory,
  type BaseRole,
  type BilingualText,
  type StageCategory,
  type TransitionKind,
  type WorkItemMapPosition,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@rabaed/domain";

// The Submittal Panel's route strip and its Workflow map (RP-1064; README §4.4 and §6; V14, V20,
// ADR 0016 and 0022), worked out apart from React so it can be tested.
//
// The route runs by Project Role: each Company's Steps in a row are one stop, e.g. Contractor →
// Consultant → Owner → Contractor, the last stop the raiser receiving the outcome. Where the item
// is comes only from the API's `position` (`GET /v1/work-items/:id/workflow`): inside the viewer's
// own Participant, its Step; with another Participant, only that Participant's role and the name
// the API gives ("Owner review" to the Contractor at an Owner review it isn't part of, ADR 0022).
// So another Company's stop is marked as a whole and none of its Steps ever is (V14). The map
// still lists every Company's Steps (V20): a Workflow is a description, not anyone's work.

export type RouteStopState = "done" | "current" | "upcoming";

export type RouteStop = {
  role: BaseRole;
  /** Its Steps, in route order; none on the closing stop, where the raiser receives the outcome. */
  stepKeys: string[];
  state: RouteStopState;
  /** On the stop another Company holds the item at: that Company as the API names it. Null on every other stop. */
  companyName: BilingualText | null;
};

export type RouteStep = {
  step: WorkflowStep;
  /** "Step N": its place in route order, from 1. */
  number: number;
  role: BaseRole;
  /** The index of its stop. */
  stop: number;
  /** What happens there: the labels of the Transitions leaving it, each once, in the Workflow's order. */
  happens: BilingualText[];
  /** The viewer's own Participant holds the item here. Never true on another Company's Step (V14). */
  current: boolean;
};

export type SubmittalRoute = { stops: RouteStop[]; steps: RouteStep[] };

export type SubmittalRouteInput = {
  /** The item's Workflow Version as the map read gives it (the raiser's Steps already named by the raiser's role). */
  definition: WorkflowDefinition;
  /** The Stages of the item's Project and Module: the Draft Stage starts the route, a closed one ends it. */
  stages: readonly { key: string; category: StageCategory }[];
  /** Where the item is, as the API gives it; null while the viewer may not know. */
  position: WorkItemMapPosition | null;
};

/** The moves that carry an item along its route: not a Return, a Send Back, a close or a Cancel. */
const onward = new Set<TransitionKind>(["send", "submit"]);

/** A stop as the route is laid out, before where the item is marks it. */
type Stop = Pick<RouteStop, "role" | "stepKeys">;

/** The stops and Step cards of the item's route, and where it is as the viewer may know. */
export function submittalRoute({ definition, stages, position }: SubmittalRouteInput): SubmittalRoute {
  const category = new Map(stages.map((s) => [s.key, s.category]));
  // The Steps someone holds: not a terminal one, nor (outside an item's map) one still held by "the raiser".
  const open = definition.steps.filter((s) => actorRole(s.actor) !== null && isOpenStageCategory(category.get(s.stage) ?? "in_progress"));
  const roleOf = new Map(open.map((s) => [s.key, actorRole(s.actor)!]));
  const start = open.find((s) => category.get(s.stage) === "draft") ?? open[0];
  if (!start) return { stops: [], steps: [] };

  // The route: from the Draft Step over the onward moves, nearest first. Among Steps as near, the
  // Company already on the route goes first, so its Steps stay one stop when one of them can also
  // skip ahead to the next Company (the review of RP-1064).
  const order: string[] = [];
  const seen = new Set([start.key]);
  for (let level = [start.key]; level.length > 0; ) {
    const role = order.length > 0 ? roleOf.get(order.at(-1)!) : undefined;
    const sorted = level.toSorted((a, b) => Number(roleOf.get(b) === role) - Number(roleOf.get(a) === role));
    order.push(...sorted);
    level = [];
    for (const key of sorted) {
      for (const t of definition.transitions) {
        if (t.from !== key || !onward.has(t.kind) || !roleOf.has(t.to) || seen.has(t.to)) continue;
        seen.add(t.to);
        level.push(t.to);
      }
    }
  }
  const stops: Stop[] = [];
  for (const key of order) {
    const role = roleOf.get(key)!;
    const last = stops.at(-1);
    if (last?.role === role) last.stepKeys.push(key);
    else stops.push({ role, stepKeys: [key] });
  }

  // A Step off the route (one only a Return reaches) joins the stop of a Step of its own role it is
  // linked to; failing that, its role's first stop, or a stop of its own at the end.
  const stopOf = (key: string) => stops.findIndex((s) => s.stepKeys.includes(key));
  let pending = open.filter((s) => !order.includes(s.key)).map((s) => s.key);
  for (let moved = true; moved && pending.length > 0; ) {
    moved = false;
    for (const key of pending) {
      const linked = definition.transitions
        .flatMap((t) => (t.from === key ? [t.to] : t.to === key ? [t.from] : []))
        .map(stopOf)
        .find((i) => i >= 0 && stops[i]!.role === roleOf.get(key));
      if (linked === undefined) continue;
      stops[linked]!.stepKeys.push(key);
      moved = true;
    }
    pending = pending.filter((key) => stopOf(key) < 0);
  }
  for (const key of pending) {
    const role = roleOf.get(key)!;
    const same = stops.find((s) => s.role === role);
    if (same) same.stepKeys.push(key);
    else stops.push({ role, stepKeys: [key] });
  }

  // The outcome goes back to the raiser, unless its own Step already ends the route.
  const raiserRole = roleOf.get(start.key)!;
  if (stops.at(-1)!.role !== raiserRole) stops.push({ role: raiserRole, stepKeys: [] });

  const current = currentStop(stops, position);
  const ownStep = position?.kind === "own" ? position.stepKey : null;
  const steps = definition.steps.filter((s) => roleOf.has(s.key));
  let number = 0;
  return {
    stops: stops.map((s, i) => ({
      ...s,
      state: stateAt(i, current),
      companyName: i === current && position?.kind === "company" ? position.companyName : null,
    })),
    steps: stops.flatMap((s, stop) =>
      s.stepKeys.map((key) => {
        const step = steps.find((x) => x.key === key)!;
        return { step, number: ++number, role: s.role, stop, happens: happensAt(definition, key), current: key === ownStep };
      }),
    ),
  };
}

/**
 * What a row of the rail's vertical Step list says under a stop (RP-1093, README §4.9): the
 * viewer's own Step where its Participant holds the item; the Company the API names where another
 * Company does (never one of its Steps, V14); the outcome on the raiser's closing stop; otherwise
 * how many Steps the stop has.
 */
export type RouteStopLine =
  | { kind: "step"; name: BilingualText }
  | { kind: "company"; name: BilingualText }
  | { kind: "outcome" }
  | { kind: "steps"; count: number };

export function submittalRouteStopLine(route: SubmittalRoute, index: number): RouteStopLine {
  return routeStopLine(route.stops[index]!, route.steps.find((s) => s.stop === index && s.current)?.step.name ?? null);
}

/**
 * A stop's line from the stop alone, as the Workflow map's large strip says it (no Step of its own),
 * or with `ownStep`, the viewer's own Step holding the item there.
 */
export function routeStopLine(stop: RouteStop, ownStep: BilingualText | null = null): RouteStopLine {
  if (stop.companyName) return { kind: "company", name: stop.companyName };
  if (ownStep) return { kind: "step", name: ownStep };
  if (stop.stepKeys.length === 0) return { kind: "outcome" };
  return { kind: "steps", count: stop.stepKeys.length };
}

/** A stop's state, by its place against the stop holding the item (`current`, null when unknown). */
function stateAt(i: number, current: number | null): RouteStopState {
  if (current === null || i > current) return "upcoming";
  return i < current ? "done" : "current";
}

/**
 * The index of the stop holding the item; null when the viewer may not know which. A closed item
 * is held by nobody: past the last stop, so every stop is done (the design's `wf()`).
 */
function currentStop(stops: Stop[], position: WorkItemMapPosition | null): number | null {
  if (position === null) return null;
  if (position.kind === "closed") return stops.length;
  if (position.kind === "own") {
    const i = stops.findIndex((s) => s.stepKeys.includes(position.stepKey));
    return i < 0 ? null : i;
  }
  // Another Company: by its role alone (V14). A role with two stops on the route can't say which, so neither is marked.
  const held = stops.flatMap((s, i) => (s.role === position.role && s.stepKeys.length > 0 ? [i] : []));
  return held.length === 1 ? held[0]! : null;
}

function happensAt(definition: WorkflowDefinition, stepKey: string): BilingualText[] {
  const labels: BilingualText[] = [];
  for (const t of definition.transitions) {
    if (t.from === stepKey && !labels.some((l) => l.en === t.label.en && l.ar === t.label.ar)) labels.push(t.label);
  }
  return labels;
}
