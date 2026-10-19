import type { ChecklistCopy } from "./checklist-template.ts";
import {
  checkChecklist,
  checklistItemFilesKey,
  isNegativeAnswer,
  type ChecklistAnswers,
  type ChecklistField,
  type CopiedChecklistField,
  type FieldError,
  type ValidationMode,
} from "./form.ts";

// A checklist in a reply Screen (RP-86, INSP-4; ADR 0024 amended 2026-10-19, ADR 0025;
// form-engine.md §3.3). The Screen's `copied_checklist` field answers the checklist the item
// copied from its Checklist Template (`copyOf`, RP-651): the Participant holding the item saves
// its answers and photos over time, at the Steps on its way to the Transition, and the
// Transition takes them, frozen and shared. The Consultant Manager's code proposes C when any
// item failed, else A.

/**
 * The checklist `field` answers on an item holding `copy`: the copy's items under the
 * Screen field's key, required as the field says. A condition never reads it, so a
 * conditional `required` counts as required.
 */
export function replyChecklistOf(field: CopiedChecklistField, copy: ChecklistCopy): ChecklistField {
  return { key: field.key, type: "checklist", label: field.label, required: field.required !== false, items: copy.items };
}

/** A reply checklist's answers as checked: what to store, or the errors, each naming its item. */
export type ReplyChecklistResult = { ok: true; answers: ChecklistAnswers } | { ok: false; errors: FieldError[] };

/**
 * Checks a reply checklist's answers in `mode`, as a Form's checklist is (form-engine.md
 * §3.1): `draft` for a save, any items answered so far; `complete` for leaving a Step where it
 * is filled, or the Transition that takes it, which wants every item answered of a required
 * one, and a negative answer's required comment and photo (`photos`: each item's confirmed
 * photos, by checklistItemFilesKey).
 */
export function checkReplyChecklist(
  checklist: ChecklistField,
  answers: unknown,
  mode: ValidationMode,
  photos: Readonly<Record<string, number>>,
): ReplyChecklistResult {
  const required = checklist.required === true;
  const checked = checkChecklist(checklist, answers, mode === "complete", required, (item) => photos[checklistItemFilesKey(checklist.key, item)] ?? 0);
  return checked.errors.length > 0 ? { ok: false, errors: checked.errors } : { ok: true, answers: checked.checked };
}

/** The Review Code a checklist proposes to the Consultant Manager (ADR 0025): C when any item failed (Fail or No), else A. */
export function proposedCode(answers: ChecklistAnswers): "A" | "C" {
  return Object.values(answers).some((entry) => entry.answer !== undefined && isNegativeAnswer(entry.answer)) ? "C" : "A";
}
