import { withMember, type Database, type Db } from "@rabaed/db";
import {
  checklistItemFilesKey,
  checkReplyChecklist,
  formFields,
  replyChecklistOf,
  type BilingualText,
  type ChecklistAnswers,
  type ChecklistCopy,
  type CopiedChecklistField,
  type FieldError,
  type FormSchema,
  type ReplyChecklistRead,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { commandResult } from "../outcomes.ts";
import { itemChecklistCopies } from "../projects/checklist-templates.ts";

// A checklist in a reply Screen (RP-86, INSP-4; ADR 0024 amended 2026-10-19, ADR 0025;
// workflow-engine.md §5.7, form-engine.md §3.3). A Screen's `copied_checklist` field answers
// the checklist the item copied from its Checklist Template. The Participant holding the item
// saves its answers as it goes, at the Steps on its way to the Transition (the database's
// app.reply_checklists_filled_now), and photographs its items as reply Documents; leaving such
// a Step checks it as a required section; the Transition whose Screen holds it takes it, and
// its pop-up reads it, with the code it proposes. Only that Participant reads it until then
// (row-level security on `reply_checklist`, V19).

type Trx = Transaction<Database>;

/** The `copied_checklist` fields of `actionForm`. */
const checklistFieldsOf = (actionForm: FormSchema | null): CopiedChecklistField[] =>
  actionForm ? formFields(actionForm).filter((f): f is CopiedChecklistField => f.type === "copied_checklist") : [];

/** The `copied_checklist` fields of the Screens of the item's pinned Workflow Version, by key (the first Transition's, by key). */
async function screenChecklistFields(trx: Trx, workItemId: string): Promise<Map<string, CopiedChecklistField>> {
  const { rows } = await sql<{ field: CopiedChecklistField }>`
    select f as field
    from work_item w
    join workflow_transition t on t.workflow_version_id = w.workflow_version_id and t.screen_version_id is not null
    cross join lateral jsonb_array_elements(coalesce(t.action_form -> 'sections', '[]')) s
    cross join lateral jsonb_array_elements(coalesce(s -> 'fields', '[]')) f
    where w.id = ${workItemId}::uuid and f ->> 'type' = 'copied_checklist'
    order by t.key
  `.execute(trx);
  const fields = new Map<string, CopiedChecklistField>();
  for (const { field } of rows) if (!fields.has(field.key)) fields.set(field.key, field);
  return fields;
}

/** The checklists the viewer's Participant holds waiting for a Transition, by field key (row-level security: the holder only). */
async function waitingAnswers(trx: Trx, workItemId: string): Promise<Map<string, ChecklistAnswers>> {
  const { rows } = await sql<{ field_key: string; answers: ChecklistAnswers }>`
    select field_key, answers from reply_checklist where work_item_id = ${workItemId}::uuid
  `.execute(trx);
  return new Map(rows.map((r) => [r.field_key, r.answers]));
}

/** How many confirmed photos each reply checklist's item holds that no Transition took yet, by checklistItemFilesKey. */
async function waitingPhotoCounts(trx: Trx, workItemId: string): Promise<Record<string, number>> {
  const { rows } = await sql<{ field_key: string; item_key: string; files: number }>`
    select field_key, item_key, count(*)::integer as files from document
    where work_item_id = ${workItemId}::uuid and reply and reply_event_id is null and item_key is not null and annotated_from_id is null
    group by field_key, item_key
  `.execute(trx);
  return Object.fromEntries(rows.map((r) => [checklistItemFilesKey(r.field_key, r.item_key), r.files]));
}

/** The reply checklists filled at the item's current Step, for the Participant holding it: key, the copy, and whether the viewer may change it now. */
async function filledNow(trx: Trx, workItemId: string): Promise<{ field_key: string; copy_of: string; can_change: boolean }[]> {
  const { rows } = await sql<{ field_key: string; copy_of: string; can_change: boolean }>`
    select field_key, copy_of, can_change from app.reply_checklists_filled_now(${workItemId}::uuid)
  `.execute(trx);
  return rows;
}

/** The checklist `field` answers on an item holding `copy`, as read, with the answers saved so far. */
const asRead = (field: CopiedChecklistField, copy: ChecklistCopy, answers: ChecklistAnswers, canChange: boolean): ReplyChecklistRead => ({
  fieldKey: field.key,
  copyOf: field.copyOf,
  label: field.label,
  name: copy.name,
  items: copy.items,
  required: replyChecklistOf(field, copy).required === true,
  answers,
  canChange,
});

/**
 * The reply checklists the viewer fills at the item's current Step (RP-86): for a Member of the
 * Participant holding it, with the answers it saved so far; empty for everyone else.
 */
export async function heldReplyChecklists(trx: Trx, workItemId: string): Promise<ReplyChecklistRead[]> {
  const filled = await filledNow(trx, workItemId);
  if (filled.length === 0) return [];
  const [fields, copies, answers] = await Promise.all([screenChecklistFields(trx, workItemId), itemChecklistCopies(trx, workItemId), waitingAnswers(trx, workItemId)]);
  return filled.flatMap((f) => {
    const field = fields.get(f.field_key);
    const copy = copies.find((c) => c.fieldKey === f.copy_of);
    return field && copy ? [asRead(field, copy, answers.get(f.field_key) ?? {}, f.can_change)] : [];
  });
}

/**
 * The checklists a Transition's Screen holds, as its pop-up reads them (RP-86): what the viewer's
 * own Participant answered beforehand, read-only; none where the item copied no checklist.
 */
export async function transitionChecklists(trx: Trx, workItemId: string, actionForm: FormSchema | null): Promise<ReplyChecklistRead[]> {
  const fields = checklistFieldsOf(actionForm);
  if (fields.length === 0) return [];
  const [copies, answers] = await Promise.all([itemChecklistCopies(trx, workItemId), waitingAnswers(trx, workItemId)]);
  return fields.flatMap((field) => {
    const copy = copies.find((c) => c.fieldKey === field.copyOf);
    return copy ? [asRead(field, copy, answers.get(field.key) ?? {}, false)] : [];
  });
}

/**
 * What is missing from the reply checklists a Transition must find complete (RP-86): those filled
 * at the Step it leaves, when it moves on (`leaving`), and those its own Screen holds (the code
 * that takes them), with the item's copy: every item answered, a negative answer's required
 * comment and photo. Errors name the field and the item.
 */
export async function incompleteReplyChecklists(
  trx: Trx,
  workItemId: string,
  { leaving, actionForm }: { leaving: boolean; actionForm: FormSchema | null },
): Promise<{ leaving: FieldError[]; taken: FieldError[] }> {
  const filledAtStep = leaving ? await filledNow(trx, workItemId) : [];
  const taken = checklistFieldsOf(actionForm);
  if (filledAtStep.length === 0 && taken.length === 0) return { leaving: [], taken: [] };
  const [fields, copies, answers, photos] = await Promise.all([
    screenChecklistFields(trx, workItemId),
    itemChecklistCopies(trx, workItemId),
    waitingAnswers(trx, workItemId),
    waitingPhotoCounts(trx, workItemId),
  ]);
  const problems = (field: CopiedChecklistField | undefined): FieldError[] => {
    const copy = field && copies.find((c) => c.fieldKey === field.copyOf);
    if (!field || !copy) return [];
    const checked = checkReplyChecklist(replyChecklistOf(field, copy), answers.get(field.key) ?? {}, "complete", photos);
    return checked.ok ? [] : checked.errors;
  };
  return {
    leaving: filledAtStep.flatMap((f) => problems(fields.get(f.field_key))),
    taken: taken.flatMap((field) => problems(field)),
  };
}

/**
 * The Recommended Code that came with the move that brought the item to the viewer, when a Member
 * of their own Participant made it (RP-433, RP-86): its `recommend_code` event is internal to that
 * Participant (V5), written with the move. Null otherwise.
 */
export async function arrivalRecommendedCode(trx: Trx, workItemId: string): Promise<{ code: string; name: BilingualText } | null> {
  const { rows } = await sql<{ code: string; name: BilingualText }>`
    with arrival as (
      select e.transition_id, e.created_at, e.audience_participant_id
      from work_item_event e
      where e.work_item_id = ${workItemId}::uuid and e.type = 'transition' and e.audience = 'internal'
        and e.actor_participant_id = e.audience_participant_id
        and e.seq = (
          select max(m.seq) from work_item_event m
          where m.work_item_id = e.work_item_id and m.type in ('transition', 'issue_code') and m.to_step_id is not null
        )
    )
    select r.payload ->> 'recommended_code' as code, oc.name
    from arrival a
    join work_item_event r on r.work_item_id = ${workItemId}::uuid and r.type = 'recommend_code'
      and r.transition_id = a.transition_id and r.created_at = a.created_at and r.audience_participant_id = a.audience_participant_id
    join work_item w on w.id = r.work_item_id
    join outcome oc on oc.project_id = w.project_id and oc.work_item_type_id = w.work_item_type_id and oc.code = r.payload ->> 'recommended_code'
  `.execute(trx);
  return rows[0] ?? null;
}

const saveRefusals = ["not_found", "project_closed", "not_editable", "forbidden", "field_not_found"] as const;
export type SaveReplyChecklistResult =
  | { ok: true }
  | { ok: false; reason: "invalid_answers"; errors: FieldError[] }
  | { ok: false; reason: (typeof saveRefusals)[number] };

/**
 * A Member of the Participant holding the item saves the answers so far of its reply checklist
 * `fieldKey` (RP-86), checked item by item against the item's copy (draft mode), replacing those
 * saved. Who may, and when, is refused first, as for its photos: never what an outsider got wrong.
 */
export function saveReplyChecklist(db: Db, memberId: string, workItemId: string, fieldKey: string, answers: unknown, now: Date): Promise<SaveReplyChecklistResult> {
  return withMember(db, memberId, async (trx): Promise<SaveReplyChecklistResult> => {
    const { rows: refused } = await sql<{ refusal: string | null }>`select app.reply_documents_refusal(${workItemId}::uuid) as refusal`.execute(trx);
    if (refused[0]!.refusal !== null) return commandResult(refused[0]!.refusal, "saved", saveRefusals);
    const filled = (await filledNow(trx, workItemId)).find((f) => f.field_key === fieldKey);
    const field = (await screenChecklistFields(trx, workItemId)).get(fieldKey);
    const copy = filled && (await itemChecklistCopies(trx, workItemId)).find((c) => c.fieldKey === filled.copy_of);
    if (!field || !copy) return { ok: false, reason: "field_not_found" };
    const checked = checkReplyChecklist(replyChecklistOf(field, copy), answers, "draft", {});
    if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
    const { rows } = await sql<{ outcome: string }>`
      select app.save_reply_checklist(${workItemId}::uuid, ${fieldKey}, ${JSON.stringify(checked.answers)}::jsonb, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "saved", saveRefusals);
  });
}
