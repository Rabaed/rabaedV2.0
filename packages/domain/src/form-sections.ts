import { isUnanswered } from "./condition.ts";
import type { FormSection } from "./form.ts";

// Who fills which Form Section, and where (form-engine.md §4, "Settled
// 2026-10-05 (part 3)"; RP-301). A section names the Workflow Steps where its
// fields can be changed (`editable_at`), all held by one Participant role; left
// out, it is the raiser's, changed at the Draft and the raiser's internal Steps.
// Pure, so the api, the web and the publish checks agree.

/** A Step of a Work Item Type's Workflow, as Form Sections are matched to it. */
export type WorkflowStepHolder = {
  key: string;
  /** The base role of the Participant that holds it (`contractor`, `consultant`…); null on a terminal Step. */
  role: string | null;
  /** The Draft Step, where the raiser starts. */
  draft: boolean;
};

/** The base role of the raiser: the one holding the Draft Step. */
const raiserRole = (steps: readonly WorkflowStepHolder[]): string | null => steps.find((s) => s.draft)?.role ?? null;

/** The Steps where `section` is changed: its `editable_at`, or else the raiser's Draft and internal Steps. */
export function sectionSteps(section: Pick<FormSection, "editable_at">, steps: readonly WorkflowStepHolder[]): string[] {
  if (section.editable_at) return section.editable_at;
  const raiser = raiserRole(steps);
  return steps.filter((s) => s.role !== null && s.role === raiser).map((s) => s.key);
}

/** What is wrong with `section`'s `editable_at` in a Workflow with `steps`: a Step it doesn't have, or Steps of two roles. */
export function editableAtProblem(
  section: Pick<FormSection, "editable_at">,
  steps: readonly WorkflowStepHolder[],
): "unknown_step" | "mixed_roles" | null {
  if (!section.editable_at) return null;
  const named = section.editable_at.map((key) => steps.find((s) => s.key === key));
  if (named.some((s) => s === undefined)) return "unknown_step";
  return new Set(named.map((s) => s!.role)).size > 1 ? "mixed_roles" : null;
}

/** Where the item is, and whether the acting Member may save its answers at all (app.can_save_answers). */
export type SectionEditContext = { step: string; canSave: boolean };

/**
 * The sections, by key in Form order, whose fields the acting Member may change
 * now: those whose Steps include the item's current one, when they may save at
 * all. Who may save, and when, is the database's (app.can_save_answers); this
 * says into which sections.
 */
export function editableSections(
  schema: { sections: readonly FormSection[] },
  steps: readonly WorkflowStepHolder[],
  { step, canSave }: SectionEditContext,
): Set<string> {
  if (!canSave) return new Set();
  return new Set(schema.sections.filter((s) => sectionSteps(s, steps).includes(step)).map((s) => s.key));
}

/**
 * The sections filled in by a Participant other than the raiser, each with the
 * base role of the one that does (form-engine.md §4): shown read-only to the
 * raiser, marked "Filled in by the Consultant".
 */
export function sectionsFilledBy(schema: { sections: readonly FormSection[] }, steps: readonly WorkflowStepHolder[]): Record<string, string> {
  const raiser = raiserRole(steps);
  return Object.fromEntries(
    schema.sections.flatMap((s) => {
      const first = sectionSteps(s, steps)[0];
      const role = steps.find((step) => step.key === first)?.role ?? null;
      return role !== null && role !== raiser ? [[s.key, role]] : [];
    }),
  );
}

/** An answer in a form two answers compare by: none when empty, a list of plain values in any order, an object's keys sorted. */
function canonical(value: unknown): unknown {
  if (isUnanswered(value)) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return items.every((v) => typeof v !== "object" || v === null) ? items.map((v) => JSON.stringify(v)).sort() : items;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, canonical(v)] as const)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  return value;
}

/**
 * The sections, in Form order, outside `editable` whose answers differ between
 * `before` and `after`: a save that changes any of them is refused as a whole.
 * A calculated field follows the answers it reads, so it is never counted.
 */
export function changedOutside(
  schema: { sections: readonly FormSection[] },
  editable: ReadonlySet<string>,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const same = (key: string) => JSON.stringify(canonical(before[key])) === JSON.stringify(canonical(after[key]));
  return schema.sections
    .filter((s) => !editable.has(s.key) && s.fields.some((f) => f.type !== "calculated" && !same(f.key)))
    .map((s) => s.key);
}
