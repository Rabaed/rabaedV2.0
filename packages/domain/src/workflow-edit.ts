import type { BilingualText } from "./company.ts";
import type { TransitionKind } from "./work-item.ts";
import type { ActorRule, WorkflowDefinition, WorkflowStep, WorkflowTransition } from "./workflow-definition.ts";

// The Workflow builder's edits (RP-439, WF-16; workflow-engine.md §11): each takes a
// draft definition and gives a new one, never changing the one it was given (the
// builder's undo keeps the old). The builder and the seam-1 test both edit through
// these; the result is saved through WF-4's API, whose checks have the last word.

/** An edit's new definition, and the key of the Step or Transition it added. */
export type WorkflowEditResult = { definition: WorkflowDefinition; key: string };

type Point = { x: number; y: number };

/** A snake_case key from an English name, unique among `taken` (a second "New step" is `new_step_2`). */
export function uniqueKey(name: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(taken);
  const slug =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "_")
      .replaceAll(/^_+|_+$/g, "")
      .replace(/^(\d)/, "s_$1")
      .slice(0, 56) || fallback;
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}_${n}`)) return `${slug}_${n}`;
}

export type NewStep = {
  name: BilingualText;
  stage: string;
  /** Null for a terminal Step (an outcome): nobody holds a closed item. */
  actor: ActorRule | null;
  /** Where it was dropped, in the layout's left-to-right units. */
  at?: Point;
};

/**
 * Adds a Transition from Step `from` to Step `to`, labelled `label` and keyed from its
 * English label. Its kind is the one the publish checks expect between those Steps: a
 * Close into an outcome, a Submit to another role, a Return back to a Step of the same
 * role the item has already passed, else a Send. Taken with the source Step's
 * permission; the author changes any of it in the side panel.
 */
export function connectSteps(definition: WorkflowDefinition, from: string, to: string, label: BilingualText): WorkflowEditResult {
  const source = stepOf(definition, from);
  const target = stepOf(definition, to);
  const kind: TransitionKind =
    target.actor === null
      ? "close"
      : source.actor?.role !== target.actor.role
        ? "submit"
        : leadsTo(definition, to, from)
          ? "return"
          : "send";
  const key = uniqueKey(label.en, definition.transitions.map((t) => t.key), "transition");
  const transition: WorkflowTransition = {
    key,
    label,
    kind,
    from,
    to,
    outcome: null,
    permission: source.actor?.permission ?? "review",
    actionForm: null,
  };
  return { key, definition: { ...definition, transitions: [...definition.transitions, transition] } };
}

function stepOf(definition: WorkflowDefinition, key: string): WorkflowStep {
  const step = definition.steps.find((s) => s.key === key);
  if (!step) throw new Error(`unknown step ${key}`);
  return step;
}

/** Whether the item can already go from Step `start` to Step `target` along the definition's Transitions. */
function leadsTo(definition: WorkflowDefinition, start: string, target: string): boolean {
  const seen = new Set([start]);
  for (const toVisit = [start]; toVisit.length > 0; ) {
    const at = toVisit.shift()!;
    if (at === target) return true;
    for (const t of definition.transitions) {
      if (t.from === at && !seen.has(t.to)) {
        seen.add(t.to);
        toVisit.push(t.to);
      }
    }
  }
  return false;
}

/** Changes a Step's names, Stage, actor rule or outcome mode; its key stays. */
export function updateStep(definition: WorkflowDefinition, key: string, patch: Partial<Omit<WorkflowStep, "key">>): WorkflowDefinition {
  return { ...definition, steps: definition.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

/** Changes a Transition's label, kind, outcome or permission; its key and Steps stay. */
export function updateTransition(
  definition: WorkflowDefinition,
  key: string,
  patch: Partial<Omit<WorkflowTransition, "key" | "from" | "to">>,
): WorkflowDefinition {
  return { ...definition, transitions: definition.transitions.map((t) => (t.key === key ? { ...t, ...patch } : t)) };
}

/** Removes a Step, every Transition into or out of it, and its place on the canvas. */
export function removeStep(definition: WorkflowDefinition, key: string): WorkflowDefinition {
  const layout = Object.fromEntries(Object.entries(definition.layout).filter(([k]) => k !== key));
  return {
    steps: definition.steps.filter((s) => s.key !== key),
    transitions: definition.transitions.filter((t) => t.from !== key && t.to !== key),
    layout,
  };
}

/** Removes one Transition. */
export function removeTransition(definition: WorkflowDefinition, key: string): WorkflowDefinition {
  return { ...definition, transitions: definition.transitions.filter((t) => t.key !== key) };
}

/** Places a Step where it was dropped, and in `stage` when it was dropped into another Stage's band. */
export function moveStep(definition: WorkflowDefinition, key: string, at: Point, stage?: string): WorkflowDefinition {
  const moved = stage === undefined ? definition : updateStep(definition, key, { stage });
  return { ...moved, layout: { ...moved.layout, [key]: at } };
}

/** A Step or Transition added, removed or changed between two definitions, by its name (a Transition's label). */
export type DefinitionChange = { change: "added" | "removed" | "changed"; kind: "step" | "transition"; key: string; name: BilingualText };

type Part = { kind: DefinitionChange["kind"]; key: string; name: BilingualText; value: string };

/**
 * What changed from `before` (the published Version) to `after` (the draft): Steps and
 * Transitions added, then removed, then changed. Moving a Step on the canvas changes nothing.
 */
export function definitionChanges(before: WorkflowDefinition, after: WorkflowDefinition): DefinitionChange[] {
  const parts = (d: WorkflowDefinition): Part[] => [
    ...d.steps.map((s) => ({ kind: "step" as const, key: s.key, name: s.name, value: JSON.stringify(s) })),
    ...d.transitions.map((t) => ({ kind: "transition" as const, key: t.key, name: t.label, value: JSON.stringify(t) })),
  ];
  const id = (p: Part) => `${p.kind}:${p.key}`;
  const old = new Map(parts(before).map((p) => [id(p), p]));
  const now = new Map(parts(after).map((p) => [id(p), p]));
  const entry = (change: DefinitionChange["change"]) => (p: Part): DefinitionChange => ({ change, kind: p.kind, key: p.key, name: p.name });
  return [
    ...[...now.values()].filter((p) => !old.has(id(p))).map(entry("added")),
    ...[...old.values()].filter((p) => !now.has(id(p))).map(entry("removed")),
    ...[...now.values()].filter((p) => old.has(id(p)) && old.get(id(p))!.value !== p.value).map(entry("changed")),
  ];
}

/** Adds a Step to `stage`, keyed from its English name; placed where it was dropped. */
export function addStep(definition: WorkflowDefinition, input: NewStep): WorkflowEditResult {
  const key = uniqueKey(input.name.en, definition.steps.map((s) => s.key), "step");
  const step: WorkflowStep = { key, name: input.name, stage: input.stage, actor: input.actor, outcomeMode: "none" };
  return {
    key,
    definition: {
      ...definition,
      steps: [...definition.steps, step],
      layout: input.at ? { ...definition.layout, [key]: input.at } : definition.layout,
    },
  };
}
