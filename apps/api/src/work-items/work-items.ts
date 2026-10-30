import { withMember, type Database, type Db, type ModuleKey } from "@rabaed/db";
import {
  answerFields,
  backwardKinds,
  changedChecklistTemplates,
  checklistsPropose,
  checklistTemplateChoices,
  type ChecklistTemplateChoice,
  discardDraftRefusals,
  duplicateMaxFileBytes,
  duplicateRefusals,
  type SharedWorkItem,
  isAnswerField,
  changedOutside,
  editableSections,
  errorsInSections,
  formFields,
  mergeFieldAnswers,
  formSchema,
  isHiddenLinkChoice,
  linkAccepts,
  offeredChoices,
  packageNumber,
  requiredByProject,
  type SupplierChoice,
  parseActionForm,
  stepAgeWeeks,
  checklistItemFilesKey,
  storedTransitionRules,
  submittalTypeCodes,
  validateAnswers,
  validationMessage,
  type TransitionRules,
  type Validation,
  type BilingualText,
  type CreateWorkItemRequest,
  type FieldError,
  type FieldStamps,
  type FormChoices,
  type FormSchema,
  type FormField,
  type FormFieldType,
  type LinkKind,
  type FormToFill,
  type FormVersion,
  type RaisableTypes,
  type SectionEditContext,
  type WorkflowStepHolder,
  type LinkSearchQuery,
  type LinkSearchResults,
  type NamedAnswers,
  type SaveAnswersRequest,
  type SavedAnswers,
  type ScopeChoice,
  type TakeTransitionRequest,
  type WorkItemActions,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemOutcome,
  type WorkItemRefField,
  type WorkItemSummary,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { withFileCopies, type CopyFiles, type FileCopy } from "../documents/copy-files.ts";
import type { FileStore } from "../documents/file-store.ts";
import { isUuid } from "../http-error.ts";
import { readOptionLists } from "../option-lists/option-lists.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";
import { itemChecklistCopies, projectChecklistTemplates } from "../projects/checklist-templates.ts";
import { arrivalRecommendedCode, heldReplyChecklists, incompleteReplyChecklists, transitionChecklists } from "./reply-checklists.ts";
import { projectRequiredKeys } from "../projects/required-fields.ts";
import { itemRaisedFrom } from "./query.ts";

// Work Items. Writes go through the app.* functions of the work items migration;
// reads go through RLS, which answers only with the items the Member can see
// (data-model.md §10). Lists and Stage counts come from the same query, so a
// count can never include an item the list hides. The Step, its Stage and Step Age
// come from app.step_as_seen: another Company sees only when the item reached the
// holder, never its internal moves (V14).
//
// Answers are checked here, with the shared validator, against the Form Version
// the item is pinned to (form-engine.md §8): draft mode on create and Save draft,
// complete mode before leaving Draft. A new `member` or `participant` answer
// must be one the filler was offered (formChoices), with the same visibility as
// everywhere else (V15): an id they couldn't see is refused like a made-up one.
// One already saved stays, even if that Member has since left the Project. The
// database decides who may write them and when, and lets an item leave Draft
// only with the answers checked here.
//
// The Built-in Fields `trade`, `location` and `scopes` are answers like any other
// to the Member, but are stored where visibility reads them: the database
// functions take them apart from the Form's own answers, and app.work_item_answers
// puts them back (RP-270).
//
// A link question (`work_item_ref`, RP-293) takes only items Link search could
// have offered the filler, or ones it already holds that they still see
// (linkableIds); anything else is refused like an unknown option. Its items are also `relies_on` Links, which
// app.save_work_item_answers keeps equal to the answer. A chosen item the reader
// can't see reaches them as a HiddenLinkChoice, never its id (ADR 0012), and
// saved back so, it keeps that choice.

type Trx = Transaction<Database>;

/** Answers that failed the Form's checks, one error per field. */
export type AnswersRefused = { ok: false; reason: "invalid_answers" | "form_incomplete"; errors: FieldError[] };

const createWorkItemRefusals = [
  "not_found",
  "not_editable",
  "project_closed",
  "type_not_found",
  "form_version_not_latest",
  "trade_required",
  "value_not_found",
  "outside_visibility",
] as const;
export type CreateWorkItemResult =
  | { ok: true; id: string }
  | Forbidden
  | AnswersRefused
  | { ok: false; reason: (typeof createWorkItemRefusals)[number] };

type FormVersionRow = { id: string; version_no: number; schema: unknown };

function toFormVersion(r: FormVersionRow): FormVersion {
  return { id: r.id, versionNo: r.version_no, schema: formSchema.parse(r.schema) };
}

/**
 * The Form a new item of the Rabaed Default Type `typeCode` on `projectId` gets, if there is
 * one: the latest published Version of the Project's own Form for the Type, else of the
 * Type's Rabaed Default Form (RP-554), as app.create_work_item checks it.
 */
export async function newItemForm(trx: Trx, projectId: string, typeCode: string): Promise<FormVersion | null> {
  const { rows } = await sql<FormVersionRow & { type_id: string | null }>`
    select v.id, v.version_no, v.schema,
      (select t.id from work_item_type t where t.code = ${typeCode} and (t.project_id = ${projectId}::uuid or t.project_id is null)
       order by t.project_id is null, t.id limit 1) as type_id
    from form_version v
    join form_definition f on f.id = v.form_definition_id
    where v.id = app.new_item_form_version(${projectId}::uuid, ${typeCode})
      -- form_definition's policy, said again: Rabaed Admin (an Engineer's Register Import, run as
      -- the default Member) reads past it (RP-657). A Rabaed Default, or one of their Projects' own.
      and (f.owner_kind = 'rabaed' or (f.owner_kind = 'project' and f.project_id in (select app.current_project_ids())))
  `.execute(trx);
  const r = rows[0];
  if (!r) return null;
  return withProjectRequired(trx, toFormVersion(r), projectId, r.type_id);
}

/** `form` with the link questions its Project makes required on the Type `typeId` required (RP-82, requiredByProject). */
async function withProjectRequired(trx: Trx, form: FormVersion, projectId: string, typeId: string | null): Promise<FormVersion> {
  if (typeId === null || !formFields(form.schema).some((f) => f.type === "work_item_ref")) return form;
  return { ...form, schema: requiredByProject(form.schema, await projectRequiredKeys(trx, projectId, typeId)) };
}

/** The Project's Scopes and Sub-scopes, which the validator checks `scopes` against. */
export async function projectScopes(trx: Trx, projectId: string): Promise<ScopeChoice[]> {
  const { rows } = await sql<{ id: string; trade_value_id: string; parent_id: string | null }>`
    select id, trade_value_id, parent_id from scope where project_id = ${projectId}
  `.execute(trx);
  return rows.map((r) => ({ id: r.id, tradeId: r.trade_value_id, parentId: r.parent_id }));
}

/**
 * The Option Lists as they are now, when the Form has a field or a table column
 * that uses one. They are never copied into a Form (RP-282), so an option added
 * since the Form Version was published is offered at once.
 */
export async function optionListsFor(trx: Trx, schema: FormSchema) {
  const uses = formFields(schema).some(
    (f) => f.type === "option_list" || (f.type === "table" && f.columns.some((c) => c.type === "option_list")),
  );
  return uses ? readOptionLists(trx) : undefined;
}

/**
 * The Project's Approved Supplier List as the validator reads it, when the Form
 * has an `approved_supplier` field (RP-595). Read through RLS: every Project
 * Member reads it (V10).
 */
async function suppliersFor(trx: Trx, schema: FormSchema, projectId: string): Promise<SupplierChoice[] | undefined> {
  if (!formFields(schema).some((f) => f.type === "approved_supplier")) return undefined;
  const { rows } = await sql<{ id: string; trade_value_id: string; status: "approved" | "withdrawn" }>`
    select id, trade_value_id, status from approved_supplier where project_id = ${projectId}::uuid
  `.execute(trx);
  return rows.map((r) => ({ id: r.id, tradeId: r.trade_value_id, status: r.status }));
}

/**
 * The Checklist Template Versions a `checklist_template` field may hold on the item
 * `workItemId` (none for a new one), when the Form has such a field (RP-651): the latest
 * Version of each of the Project's templates, the Versions the item holds a copy of, and
 * those its `held` answers name without one yet (a Revision's, copied from the item it
 * revises). Read through RLS: every Project Member reads the templates (V20).
 */
async function checklistTemplatesFor(
  trx: Trx,
  schema: FormSchema,
  projectId: string,
  workItemId: string | null,
  held: Readonly<Record<string, unknown>> = {},
): Promise<ChecklistTemplateChoice[] | undefined> {
  const fields = formFields(schema).filter((f) => f.type === "checklist_template");
  if (fields.length === 0) return undefined;
  const choices = checklistTemplateChoices(await projectChecklistTemplates(trx, projectId), workItemId ? await itemChecklistCopies(trx, workItemId) : []);
  const named = fields.map((f) => held[f.key]).filter((v): v is string => typeof v === "string" && isUuid(v) && !choices.some((c) => c.id === v));
  if (named.length === 0) return choices;
  const { rows } = await sql<{ id: string; trade_value_id: string; name: BilingualText }>`
    select id, trade_value_id, name from checklist_template_version where id = any(${named}::uuid[]) and project_id = ${projectId}::uuid
  `.execute(trx);
  return [...choices, ...rows.map((r) => ({ id: r.id, tradeId: r.trade_value_id, offered: false, name: r.name }))];
}

/**
 * Copies onto the item the Checklist Template Versions its `checklist_template` answers
 * pick, in the same transaction as the save (app.sync_work_item_checklists). The answers
 * were checked first, so anything but synced is unexpected: it throws, and nothing is saved.
 */
async function syncChecklists(trx: Trx, schema: FormSchema, workItemId: string, now: Date): Promise<void> {
  if (!formFields(schema).some((f) => f.type === "checklist_template")) return;
  const { rows } = await sql<{ outcome: string }>`
    select app.sync_work_item_checklists(${workItemId}::uuid, ${now}) as outcome
  `.execute(trx);
  checkedOutcome(rows[0]!.outcome, ["synced"]);
}

/** Checked answers as the database functions take them: the Form's own, and the Built-in Fields apart. */
export function storedAnswers({ trade, location, scopes, ...data }: Record<string, unknown>) {
  return {
    data: JSON.stringify(data),
    tradeId: (trade as string | undefined) ?? null,
    locationId: (location as string | undefined) ?? null,
    scopeIds: (scopes as string[] | undefined) ?? [],
  };
}

/** A Form's link questions. */
const linkQuestions = (schema: FormSchema) => formFields(schema).filter((f): f is WorkItemRefField => f.type === "work_item_ref");

/** The keys of a Form's link questions. */
const linkQuestionKeys = (schema: FormSchema) => linkQuestions(schema).map((f) => f.key);

/** A link question's item as app.work_item_answers gives one the reader can't see. */
type HiddenFromDb = { document_number: string; subject: string };
const isHiddenFromDb = (value: unknown): value is HiddenFromDb => typeof value === "object" && value !== null && "document_number" in value;

/** Each link question's items in `answers`, mapped by `map`. */
function mapLinkItems(schema: FormSchema, answers: Record<string, unknown>, map: (item: unknown) => unknown): Record<string, unknown> {
  const out = { ...answers };
  for (const key of linkQuestionKeys(schema)) {
    const items = out[key];
    if (Array.isArray(items)) out[key] = items.map(map);
  }
  return out;
}

/** Answers as app.work_item_answers gives them, as the API carries them: a hidden link item as a HiddenLinkChoice. */
const answersFromDb = (schema: FormSchema, data: Record<string, unknown>) =>
  mapLinkItems(schema, data, (item) => (isHiddenFromDb(item) ? { documentNumber: item.document_number, subject: item.subject } : item));

/** Checked answers as app.save_work_item_answers takes them: a hidden link item back as it gave it. */
const answersToDb = (schema: FormSchema, answers: Record<string, unknown>) =>
  mapLinkItems(schema, answers, (item) => (isHiddenLinkChoice(item) ? { document_number: item.documentNumber, subject: item.subject } : item));

/**
 * The ids given in each link question of `answers` that the acting Member may
 * choose there, by field key: those Link search could have offered them for it
 * (Submitted, visible, in the Project, not `workItemId` itself, what its
 * `accepts` takes), and those the field already holds in `held` (as they may
 * read it) while they still see them, even if they have gone back to a Draft or
 * no longer fit `accepts`. Undefined when the Form has no link question.
 */
async function linkableIds(
  trx: Trx,
  schema: FormSchema,
  projectId: string,
  workItemId: string | null,
  answers: unknown,
  held: Readonly<Record<string, unknown>> = {},
): Promise<Record<string, Set<string>> | undefined> {
  const fields = linkQuestions(schema);
  if (fields.length === 0) return undefined;
  const given: Record<string, unknown> = typeof answers === "object" && answers !== null ? { ...answers } : {};
  const idsIn = (items: unknown) => (Array.isArray(items) ? items : []).filter((v): v is string => typeof v === "string" && isUuid(v));
  const keptIn = (key: string) => idsIn(held[key]).filter((id) => idsIn(given[key]).includes(id));
  const ids = fields.flatMap((f) => idsIn(given[f.key]));
  if (ids.length === 0) return Object.fromEntries(fields.map((f) => [f.key, new Set<string>()]));
  const kept = fields.flatMap((f) => keptIn(f.key));
  const { rows } = await sql<{ id: string; module: ModuleKey; type: string; outcome: string | null; closed: boolean; submitted: boolean }>`
    select t.id, ty.module_key as module, ty.code as type, t.outcome, t.closed_at is not null as closed, app.work_item_submitted(t.id) as submitted
    from work_item t
    join work_item_type ty on ty.id = t.work_item_type_id
    where t.id = any(${ids}::uuid[]) and t.project_id = ${projectId} and t.id is distinct from ${workItemId}::uuid
      and (app.work_item_submitted(t.id) or (t.id = any(${kept}::uuid[]) and app.sees_work_item(t.id)))
  `.execute(trx);
  return Object.fromEntries(
    fields.map((f) => {
      const keep = new Set(keptIn(f.key));
      return [f.key, new Set(rows.filter((r) => keep.has(r.id) || (r.submitted && linkAccepts(f.accepts, r))).map((r) => r.id))];
    }),
  );
}

/** A visible item's Form as the acting Member may work with it. */
type PinnedForm = {
  form: FormVersion;
  /** Its Project, whose Scopes the validator checks `scopes` against. */
  projectId: string;
  /**
   * The answers now, Built-in Fields included, as this Member may read them: less
   * any reference they may not see (ADR 0012). While the answers are open only the
   * raiser sees the item, and its references are its own, so nothing is stripped
   * from what a Transition checks.
   */
  data: Record<string, unknown>;
  /** The answers' hash, as app.take_transition compares it; null unless they may save now or hold the raiser's Step (a Submit). */
  dataSha256: Buffer | null;
  /** They may save its answers now (app.can_save_answers). */
  canSave: boolean;
  /** It has been Submitted at least once: its Checklist Template picks are fixed (RP-651). */
  submitted: boolean;
  /** The Form as they may fill it now: the sections they may change, and who fills the others. */
  toFill: FormToFill;
  /** The sections the Step the Member sees is filled at (a Submit checks them, whoever takes it). */
  sectionsAtStep: string[];
};

/** A visible item's pinned Form Version and its answers; null when the Member can't see the item. */
async function pinnedForm(trx: Trx, workItemId: string): Promise<PinnedForm | null> {
  const { rows } = await sql<
    FormVersionRow & {
      project_id: string;
      data: Record<string, unknown>;
      data_sha256: Buffer | null;
      can_save: boolean;
      submitted: boolean;
      workflow_version_id: string;
      step_key: string;
      work_item_type_id: string;
    }
  >`
    select v.id, v.version_no, v.schema, w.project_id, w.work_item_type_id, app.work_item_answers(w.id) as data,
      app.answers_sha256(w.id) as data_sha256, app.can_save_answers(w.id) as can_save,
      w.submitted_at is not null as submitted, w.workflow_version_id, s.key as step_key
    from work_item w
    join form_version v on v.id = w.form_version_id
    -- The Step as the Member sees it (V14): the current one whenever they may save,
    -- since their Participant then holds the item.
    cross join lateral app.step_as_seen(w.id) seen
    join workflow_step s on s.id = seen.step_id
    where w.id = ${workItemId}
  `.execute(trx);
  const r = rows[0];
  if (!r) return null;
  // Its Project may make a link question required (RP-82): read so wherever its answers are checked.
  const form = await withProjectRequired(trx, toFormVersion(r), r.project_id, r.work_item_type_id);
  // app.answers_sha256 is also given to the holder of the raiser's Step who may not save (their Submit, RP-525).
  const canSave = r.can_save;
  const steps = await workflowSteps(trx, r.workflow_version_id);
  return {
    form,
    projectId: r.project_id,
    data: answersFromDb(form.schema, r.data),
    dataSha256: r.data_sha256,
    canSave,
    submitted: r.submitted,
    toFill: formToFillAt(form, steps, { step: r.step_key, canSave }),
    sectionsAtStep: [...editableSections(form.schema, steps.steps, { step: r.step_key, canSave: true })],
  };
}

/** A Workflow Version's Steps as Form Sections are matched to them. */
type WorkflowSteps = { steps: WorkflowStepHolder[] };

/** The Steps of the Workflow Version `workflowVersionId`. Definitions, which every Member reads. */
async function workflowSteps(trx: Trx, workflowVersionId: string): Promise<WorkflowSteps> {
  return (await workflowStepsOf(trx, [workflowVersionId])).get(workflowVersionId) ?? { steps: [] };
}

/** The Steps of each Workflow Version of `workflowVersionIds`, by its id, in one read. */
async function workflowStepsOf(trx: Trx, workflowVersionIds: readonly string[]): Promise<Map<string, WorkflowSteps>> {
  const { rows } = await sql<{ version_id: string; key: string; role: string | null; draft: boolean }>`
    -- A Draft as app.is_draft_step (which the app role can't call) tells it: a Stage of category draft, in any
    -- Module, of the Stage set the Workflow is published against (RP-428): its Project's for a Project's own
    -- Workflow, the Rabaed Defaults' for any other.
    select s.workflow_version_id as version_id, s.key, app.actor_holder(s.actor_rule) as role,
      exists (
        select 1 from stage st
        where st.key = s.stage_key and st.category = 'draft'
          and case when d.owner_kind = 'project' then st.project_id = d.project_id else st.owner_kind = 'rabaed' end
      ) as draft
    from workflow_step s
    join workflow_version v on v.id = s.workflow_version_id
    join workflow_definition d on d.id = v.workflow_definition_id
    where s.workflow_version_id = any(${workflowVersionIds}::uuid[])
    order by s.key
  `.execute(trx);
  const byVersion = new Map<string, WorkflowSteps>();
  for (const { version_id, key, role, draft } of rows) {
    const steps = byVersion.get(version_id) ?? { steps: [] };
    steps.steps.push({ key, role, draft });
    byVersion.set(version_id, steps);
  }
  return byVersion;
}

/** `form` as it is filled in at `step`: the sections editable there. */
export function formToFillAt(form: FormVersion, { steps }: WorkflowSteps, at: SectionEditContext): FormToFill {
  return { ...form, editableSections: [...editableSections(form.schema, steps, at)] };
}

/**
 * The Form for a new item of the Rabaed Default Type `typeCode` on one of the
 * Member's Projects: the latest published Version of the Project's own Form for the
 * Type, else of its Rabaed Default Form (newItemForm), as it is filled in at the
 * Draft of the Workflow Version it would start on (draftOf). Null when it isn't one of
 * their Projects, or there is no such Type.
 */
export function getNewWorkItemForm(db: Db, memberId: string, projectId: string, typeCode: string): Promise<FormToFill | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const form = await newItemForm(trx, projectId, typeCode);
    if (!form) return null;
    const draft = await draftOf(trx, projectId, typeCode);
    return draft && formToFillAt(form, ...draft);
  });
}

/**
 * The Types of a Module (the Submittals unless named) the Member may raise on one of their
 * Projects (RP-590; the Snag List's "+ New", RP-94): each has a published Workflow bound for
 * their Participant (app.new_item_workflow_version) whose Draft Step's actor rule lets them
 * raise it, app.may_raise_type, the rule app.create_work_item checks, read through
 * app.raisable_type_ids (RP-1089). The MAR first,
 * then the SAR and DAR; other Types by code. Null when it isn't one of their Projects.
 */
export function getRaisableTypes(db: Db, memberId: string, projectId: string, module: ModuleKey = "submittals"): Promise<RaisableTypes | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const { rows } = await sql<{ code: string; name: BilingualText }>`
      select t.code, t.name
      from app.raisable_type_ids(${projectId}::uuid, ${module}) r
      join work_item_type t on t.id = r.work_item_type_id
      order by array_position(${[...submittalTypeCodes]}::text[], t.code::text), t.code
    `.execute(trx);
    return { types: rows.map((r) => ({ code: r.code, name: r.name })) };
  });
}

/**
 * The Steps of the Workflow a new item of `typeCode` raised by the acting Member
 * on `projectId` starts on, and its Draft: the latest published Version of the
 * Workflow bound for their Participant, as app.create_work_item resolves it (RP-426).
 */
export async function draftOf(trx: Trx, projectId: string, typeCode: string): Promise<[WorkflowSteps, SectionEditContext] | null> {
  // app.new_item_workflow_version is security invoker: Rabaed Admin (an Engineer's Register
  // Import, run as the default Member) reads past row-level security through it, so the Version
  // it answers is kept only when the Member reads its Workflow (workflow_definition's policy,
  // said again): a Rabaed Default, or one of their Projects' own (RP-657). A binding names
  // nothing else (app.check_workflow_binding).
  const { rows } = await sql<{ type_id: string; workflow_version_id: string | null }>`
    select t.id as type_id, (
      select v.id from workflow_version v
      join workflow_definition d on d.id = v.workflow_definition_id
      where v.id = app.new_item_workflow_version(${projectId}::uuid, t.id, (
          select pm.participant_id from project_member pm
          where pm.project_id = ${projectId}::uuid and pm.member_id = app.current_member_id() and pm.status = 'active'
            and pm.participant_id in (select app.current_participant_ids())
        ))
        and (d.owner_kind = 'rabaed' or (d.owner_kind = 'project' and d.project_id in (select app.current_project_ids())))
    ) as workflow_version_id
    from work_item_type t
    where t.owner_kind = 'rabaed' and t.code = ${typeCode} and not t.raised_from_item_only
  `.execute(trx);
  const r = rows[0];
  // No Workflow for the raiser's Participant: the Type isn't theirs to raise (RP-590).
  if (!r?.workflow_version_id) return null;
  const workflow = await workflowSteps(trx, r.workflow_version_id);
  const draft = workflow.steps.find((s) => s.draft);
  if (!draft) throw new Error(`The Workflow of Work Item Type ${typeCode} has no Draft Step`);
  return [workflow, { step: draft.key, canSave: true }];
}

/**
 * What the acting Member may choose in `member` and `participant` fields on one
 * of their Projects (V15): their own Participant's Project Members (RLS shows no
 * one else's); their own Participant, the Host Company's and, on an item, those
 * on it (app.form_participant_choices).
 */
export async function formChoices(trx: Trx, projectId: string, workItemId: string | null): Promise<FormChoices> {
  const { rows: members } = await sql<{ id: string; name: BilingualText }>`
    select m.id, m.full_name as name
    from project_member pm
    join member m on m.id = pm.member_id
    where pm.project_id = ${projectId} and pm.status = 'active' and m.status = 'active'
      -- Already all RLS shows; said here too, so a wider policy never widens the choices.
      and pm.participant_id in (select app.current_participant_ids())
    order by m.full_name ->> 'en', m.id
  `.execute(trx);
  const { rows: participants } = await sql<{ id: string; name: BilingualText }>`
    select participant_id as id, legal_name as name from app.form_participant_choices(${projectId}::uuid, ${workItemId}::uuid)
  `.execute(trx);
  return { members, participants };
}

/** The ids the filler may choose (and those already `saved`), when the Form has fields that take them. */
async function offeredFor(
  trx: Trx,
  schema: FormSchema,
  projectId: string,
  workItemId: string | null,
  saved: Record<string, unknown> = {},
) {
  const needed = formFields(schema).some((f) => f.type === "member" || f.type === "participant");
  return needed ? offeredChoices(await formChoices(trx, projectId, workItemId), schema, saved) : undefined;
}

/** What the Member may choose on a new item of one of their Projects; null when it isn't one of theirs. */
export function getNewWorkItemFormChoices(db: Db, memberId: string, projectId: string): Promise<FormChoices | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    return onProject ? formChoices(trx, projectId, null) : null;
  });
}

/** What the Member may choose on a visible item; null when they can't see it. */
export function getWorkItemFormChoices(db: Db, memberId: string, workItemId: string): Promise<FormChoices | null> {
  return withMember(db, memberId, async (trx) => {
    const item = await trx.selectFrom("work_item").select("project_id").where("id", "=", workItemId).executeTakeFirst();
    return item ? formChoices(trx, item.project_id, workItemId) : null;
  });
}

/**
 * The Form Version a visible item is pinned to, as the Member may fill it in
 * now; null when they can't see the item.
 */
export function getWorkItemForm(db: Db, memberId: string, workItemId: string): Promise<FormToFill | null> {
  return withMember(db, memberId, async (trx) => (await pinnedForm(trx, workItemId))?.toFill ?? null);
}

type SummaryRow = {
  id: string;
  project_id: string;
  type_code: string;
  type_name: BilingualText;
  title: string;
  document_number: string | null;
  stage_key: string;
  stage_name: BilingualText;
  stage_category: WorkItemSummary["stage"]["category"];
  trade_id: string;
  trade_code: string;
  trade_name: BilingualText;
  location_id: string | null;
  location_code: string | null;
  location_name: BilingualText | null;
  /** Null for a Draft with no number: its Step began when it was started, which nobody sees. */
  step_entered_at: Date | null;
};

/** The visible Work Items matching `where`, as list rows. */
function visibleItems(trx: Trx, where: RawBuilder<unknown>) {
  return sql<SummaryRow>`
    select w.id, w.project_id, t.code as type_code, t.name as type_name, w.title, w.document_number,
      st.key as stage_key, st.name as stage_name, st.category as stage_category,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      case when w.document_number is null then null else seen.entered_at end as step_entered_at
    from work_item w
    cross join lateral app.step_as_seen(w.id) seen
    join work_item_type t on t.id = w.work_item_type_id
    join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
    -- Trade and Location as the viewer may know them: as at a Send Back for everyone but the holder (RP-582, V19).
    join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
    join work_item_dimension_value_seen tdv on tdv.work_item_id = w.id and tdv.dimension_id = td.id
    join dimension_value tv on tv.id = tdv.dimension_value_id
    join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
    left join work_item_dimension_value_seen ldv on ldv.work_item_id = w.id and ldv.dimension_id = ld.id
    left join dimension_value lv on lv.id = ldv.dimension_value_id
    where ${where}
    order by seen.entered_at desc, w.id desc
  `
    .execute(trx)
    .then((r) => r.rows);
}

function toSummary(r: SummaryRow, now: Date): WorkItemSummary {
  return {
    id: r.id,
    projectId: r.project_id,
    type: { code: r.type_code, name: r.type_name },
    title: r.title,
    documentNumber: r.document_number,
    stage: { key: r.stage_key, name: r.stage_name, category: r.stage_category },
    trade: { id: r.trade_id, code: r.trade_code, name: r.trade_name },
    location: r.location_id ? { id: r.location_id, code: r.location_code!, name: r.location_name! } : null,
    stepEnteredAt: r.step_entered_at?.toISOString() ?? null,
    stepAgeWeeks: r.step_entered_at ? stepAgeWeeks(r.step_entered_at, now) : null,
  };
}

/**
 * A Member creates a Work Item in Draft on one of their Projects, pinned to the
 * latest published Form Version of its Type, with its answers so far (draft mode).
 */
export function createWorkItem(
  db: Db,
  memberId: string,
  projectId: string,
  input: Required<CreateWorkItemRequest>,
  now: Date,
): Promise<CreateWorkItemResult> {
  return refusedAsForbidden(() => withMember(db, memberId, (trx) => createWorkItemIn(trx, projectId, input, now)));
}

/** createWorkItem, in a transaction already acting as the Member (Duplicate creates its Draft in its own). */
async function createWorkItemIn(trx: Trx, projectId: string, input: Required<CreateWorkItemRequest>, now: Date): Promise<CreateWorkItemResult> {
  const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
  if (!onProject) return { ok: false, reason: "not_found" };
  const form = await newItemForm(trx, projectId, input.type);
  if (!form) return { ok: false, reason: "type_not_found" };
  // Only the Form Sections editable at the Draft take answers (form-engine.md §4).
  const draft = await draftOf(trx, projectId, input.type);
  // A Type with no Workflow for the raiser's Participant isn't theirs to raise (RP-590).
  if (!draft) return { ok: false, reason: "type_not_found" };
  const atDraft = formToFillAt(form, ...draft);
  if (changedOutside(form.schema, new Set(atDraft.editableSections), {}, input.answers).length > 0) {
    return { ok: false, reason: "not_editable" };
  }
  const checked = validateAnswers(form.schema, input.answers, "draft", {
    scopes: await projectScopes(trx, projectId),
    offered: await offeredFor(trx, form.schema, projectId, null),
    optionLists: await optionListsFor(trx, form.schema),
    linkable: await linkableIds(trx, form.schema, projectId, null, input.answers),
    suppliers: await suppliersFor(trx, form.schema, projectId),
    checklistTemplates: await checklistTemplatesFor(trx, form.schema, projectId, null),
  });
  if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
  // A link question's items are saved with their Links, by app.save_work_item_answers below.
  const linkKeys = linkQuestionKeys(form.schema).filter((key) => key in checked.answers);
  const stored = storedAnswers(Object.fromEntries(Object.entries(checked.answers).filter(([key]) => !linkKeys.includes(key))));
  const { rows } = await sql<{ outcome: string; work_item_id: string | null }>`
    select outcome, work_item_id from app.create_work_item(
      ${projectId}::uuid, ${input.type}, ${input.title}, ${form.id}::uuid, ${stored.data}::jsonb,
      ${stored.tradeId}::uuid, ${stored.locationId}::uuid, ${now}, ${stored.scopeIds}::uuid[])
  `.execute(trx);
  const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...createWorkItemRefusals]);
  const { work_item_id } = rows[0]!;
  if (outcome !== "created") return { ok: false, reason: outcome };
  if (linkKeys.length > 0) {
    // In the same transaction. Its items were checked above, so anything but
    // saved is unexpected: it throws, and nothing is created.
    const all = storedAnswers(checked.answers);
    const { rows: saved } = await sql<{ outcome: string }>`
      select app.save_work_item_answers(
        ${work_item_id}::uuid, ${all.data}::jsonb, ${all.tradeId}::uuid, ${all.locationId}::uuid, ${all.scopeIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    checkedOutcome(saved[0]!.outcome, ["saved"]);
  }
  await syncChecklists(trx, form.schema, work_item_id!, now);
  await recordFieldTimes(trx, work_item_id!, now);
  return { ok: true, id: work_item_id! };
}

/** `text` as a LIKE pattern that matches it anywhere, with its own %, _ and \ taken literally. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Link search (visibility.md "Link search", scenario 79): the Project's items
 * whose Document Number or Subject contains `q`, whatever the case, the latest
 * Submitted first (the Submission Date, which every caller who sees an item may
 * read; never when its Draft was started), one page at a time. Only items the Member sees (RLS, the list's own
 * path) that have been Submitted (app.work_item_submitted): never a Draft or an
 * item in internal review. With a link question's `accepts` (`modules`, RP-1080;
 * `types`, `outcomes`; RP-82), only those it takes. One row more than the page is read only to tell
 * whether there is a next page; there is no total, so nothing counts hidden
 * matches. Null when it isn't one of the Member's Projects.
 */
export function searchLinkTargets(db: Db, memberId: string, projectId: string, query: LinkSearchQuery): Promise<LinkSearchResults | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const pattern = containsPattern(query.q);
    // A link question's `accepts` (form.ts linkAccepts): its Modules and Types, and with outcomes only closed items with one.
    const modules = query.modules ?? null;
    const types = query.types ?? null;
    const outcomes = query.outcomes ?? null;
    const { rows } = await sql<{ id: string; document_number: string; title: string }>`
      select w.id, w.document_number, w.title
      from work_item w
      join work_item_type ty on ty.id = w.work_item_type_id
      where w.project_id = ${projectId} and app.work_item_submitted(w.id)
        and (w.document_number ilike ${pattern} or w.title ilike ${pattern})
        and (${modules}::text[] is null or ty.module_key = any(${modules}::text[]))
        and (${types}::text[] is null or ty.code = any(${types}::text[]))
        and (${outcomes}::text[] is null or (w.closed_at is not null and w.outcome = any(${outcomes}::text[])))
      order by w.submitted_at desc nulls last, w.id desc
      limit ${query.limit + 1} offset ${(query.page - 1) * query.limit}
    `.execute(trx);
    return {
      links: rows.slice(0, query.limit).map((r) => ({ id: r.id, documentNumber: r.document_number, subject: r.title })),
      nextPage: rows.length > query.limit ? query.page + 1 : null,
    };
  });
}

/** One Work Item, or null when the Member can't see it (exactly as if it didn't exist). */
export function getWorkItem(db: Db, memberId: string, workItemId: string, now: Date): Promise<WorkItemDetail | null> {
  return withMember(db, memberId, async (trx) => {
    const [row] = await visibleItems(trx, sql`w.id = ${workItemId}`);
    if (!row) return null;
    const { rows } = await sql<{
      data: Record<string, unknown>;
      form_version_id: string;
      creation_date: Date | null;
      submitted_at: Date | null;
      step_key: string;
      step_name: BilingualText;
      raised_by: BilingualText;
      held_by: BilingualText | null;
      holder_name: BilingualText | null;
      pool_names: BilingualText[] | null;
      outcome: WorkItemOutcome | null;
      closed_at: Date | null;
      can_save_answers: boolean;
      sent_back_for_comment: boolean;
      revision_no: number;
      versions_changed: boolean;
      can_create_revision: boolean;
      can_discard_revision: boolean;
      can_create_replacement: boolean;
      can_duplicate: boolean;
      can_discard_draft: boolean;
      workflow_name: BilingualText;
      workflow_version_no: number;
      paper_ref: string | null;
      draft_step: boolean;
      module_key: ModuleKey;
    }>`
      select app.work_item_answers(w.id) as data, w.form_version_id, app.work_item_creation_date(w.id) as creation_date,
        -- The Paper ref (RP-639): everyone who sees the item reads it; it changes only while a Draft.
        w.paper_ref, coalesce(st.category = 'draft', false) as draft_step,
        wf.name as workflow_name, wf.version_no as workflow_version_no, ty.module_key,
        w.submitted_at, w.outcome, w.closed_at, s.key as step_key, s.name as step_name,
        -- At the Owner's review, "Owner review" to all but its holder and the recommending Consultant (ADR 0022).
        raiser.legal_name as raised_by, coalesce(app.with_owner_review(w.id), holder.legal_name) as held_by, m.full_name as holder_name,
        pool.names as pool_names,
        app.can_save_answers(w.id) as can_save_answers, app.sent_back_for_comment(w.id) as sent_back_for_comment, w.revision_no, app.revision_versions_changed(w.id) as versions_changed,
        app.can_create_revision(w.id) as can_create_revision, app.can_discard_revision(w.id) as can_discard_revision,
        app.can_create_replacement(w.id) as can_create_replacement,
        ${canDuplicate(sql.ref("w"))} as can_duplicate, app.can_discard_draft(w.id) as can_discard_draft
      from work_item w
      cross join lateral app.step_as_seen(w.id) seen
      join workflow_step s on s.id = seen.step_id
      join work_item_type ty on ty.id = w.work_item_type_id
      left join stage st on st.project_id = w.project_id and st.module_key = ty.module_key and st.key = seen.stage_key
      -- Its Workflow's name and Version, for whoever sees the item, whatever Workflow rows they read (V20).
      left join lateral app.work_item_workflow(w.id) wf on true
      join app.work_item_companies(w.id) raiser on raiser.participant_id = w.raised_by_participant_id
      left join app.work_item_holder(w.id) a on true
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      -- Only the viewer's own Participant's holder is named, and member's own RLS shows only their own Company's people (V14).
      left join member m on m.id = a.assignee_member_id
      -- While it waits in a pool of the viewer's own Participant: who it waits on (§3.4, V14).
      left join lateral app.work_item_pool(w.id) pool on true
      where w.id = ${workItemId}
    `.execute(trx);
    const d = rows[0]!;
    const { schema } = await trx.selectFrom("form_version").select("schema").where("id", "=", d.form_version_id).executeTakeFirstOrThrow();
    const answers = answersFromDb(formSchema.parse(schema), d.data);
    const scopes = await itemScopes(trx, workItemId);
    const { named, unnamed } = await namedAnswers(trx, workItemId);
    const stamps = await fieldStamps(trx, workItemId, false);
    const { rows: dropped } = await sql<{ field_key: string; label: BilingualText }>`
      select field_key, label from app.revision_dropped_fields(${workItemId}::uuid)
    `.execute(trx);
    const { rows: fixed } = await sql<{ fields: ("trade" | "location")[] }>`
      select app.work_item_fixed_fields(${workItemId}::uuid) as fields
    `.execute(trx);
    const { rows: auto } = await sql<{ autosave: boolean }>`select app.answers_autosave(${workItemId}::uuid) as autosave`.execute(trx);
    // The items raised from it per Type (WF-11: its Comments, its Snags), only those the viewer sees.
    const { rows: raisedItems } = await sql<{ type_code: string; type_name: BilingualText; open_count: number; closed_count: number }>`
      select type_code, type_name, open_count, closed_count from app.work_item_raised_item_counts(${workItemId}::uuid)
    `.execute(trx);
    const raisedCount = (f: { type_code: string; type_name: BilingualText; open_count: number; closed_count: number }) => ({
      type: { code: f.type_code, name: f.type_name },
      open: f.open_count,
      closed: f.closed_count,
    });
    // A Revision's previous item's, the same per Type (RP-653): what Rev 0 left, as the viewer sees it.
    const { rows: previous } = await sql<{
      previous_revision_no: number;
      previous_document_number: string | null;
      type_code: string;
      type_name: BilingualText;
      open_count: number;
      closed_count: number;
    }>`
      select previous_revision_no, previous_document_number, type_code, type_name, open_count, closed_count
      from app.work_item_previous_raised_item_counts(${workItemId}::uuid)
    `.execute(trx);
    // The same follow-ups one each (RP-655): the Snag List can't list them, as its filter matches the
    // Document Number every Revision of the chain shares.
    const { rows: previousRows } = previous[0]
      ? await sql<{ work_item_id: string; type_code: string; document_number: string | null; title: string; closed: boolean }>`
          select work_item_id, type_code, document_number, title, closed from app.work_item_previous_raised_items(${workItemId}::uuid)
        `.execute(trx)
      : { rows: [] };
    const { rows: source } = await sql<{ work_item_id: string; document_number: string | null; subject: string }>`
      select work_item_id, document_number, subject from app.work_item_duplicated_from(${workItemId}::uuid)
    `.execute(trx);
    // Its Package (RP-659), as its row gives it: only one the viewer sees (work_item.package_id is not theirs to read).
    const { rows: pkg } = await sql<{ package_id: string; seq: number; name: BilingualText; company_name: BilingualText }>`
      select package_id, seq, name, app.package_owner_name(package_id) as company_name from app.work_item_package(${workItemId}::uuid)
    `.execute(trx);
    const { rows: record } = await sql<{ state: "preparing" | "published" | null }>`select app.documental_record_state(${workItemId}::uuid) as state`.execute(trx);
    return {
      ...toSummary(row, now),
      module: d.module_key,
      // A Snag List item's Raised from card (RP-628), as its row names it (E1).
      raisedFrom: d.module_key === "snag_list" ? await itemRaisedFrom(trx, workItemId) : null,
      formVersionId: d.form_version_id,
      workflow: { name: d.workflow_name, versionNo: d.workflow_version_no },
      revisionNo: d.revision_no,
      versionsChanged: d.versions_changed,
      droppedFields: dropped.map((f) => ({ key: f.field_key, label: f.label })),
      fixedByNumber: fixed[0]!.fields,
      // Another Company's people, and a Company the viewer may not see, are never identified, not even by an id (V14, V15).
      answers: Object.fromEntries(Object.entries(answers).filter(([key]) => !unnamed.has(key))),
      namedAnswers: named,
      checklistCopies: await itemChecklistCopies(trx, workItemId),
      replyChecklists: await heldReplyChecklists(trx, workItemId),
      fieldTimes: fieldTimesFor(stamps, memberId),
      autosave: auto[0]!.autosave,
      sentBackForComment: d.sent_back_for_comment,
      scopes,
      step: { key: d.step_key, name: d.step_name },
      raisedBy: { companyName: d.raised_by },
      heldBy: d.held_by
        ? {
            companyName: d.held_by,
            memberName: d.holder_name,
            pool: d.pool_names === null ? null : { names: d.pool_names },
          }
        : null,
      outcome: d.outcome,
      closedAt: d.closed_at?.toISOString() ?? null,
      documentalRecord: record[0]!.state,
      // When the Draft was started is audit only, shown to nobody (visibility.md "Creation Date", scenario 61).
      creationDate: d.creation_date?.toISOString() ?? null,
      submissionDate: d.submitted_at?.toISOString() ?? null,
      // The raiser's Participant only, and no time (visibility.md "Creation Date").
      duplicatedFrom: source[0]
        ? { workItemId: source[0].work_item_id, documentNumber: source[0].document_number, subject: source[0].subject }
        : null,
      paperRef: d.paper_ref,
      raisedItems: raisedItems.map(raisedCount),
      previousRaisedItems: previous[0]
        ? {
            revisionNo: previous[0].previous_revision_no,
            documentNumber: previous[0].previous_document_number,
            items: previous.map(raisedCount),
            raised: previousRows.map((r) => ({ id: r.work_item_id, typeCode: r.type_code, documentNumber: r.document_number, title: r.title, closed: r.closed })),
          }
        : null,
      ...(pkg[0] ? { package: { id: pkg[0].package_id, number: packageNumber(pkg[0].seq), name: pkg[0].name, companyName: pkg[0].company_name } } : {}),
      actions: {
        ...(await actions(trx, workItemId)),
        saveAnswers: d.can_save_answers,
        createRevision: d.can_create_revision,
        createReplacement: d.can_create_replacement,
        discardRevision: d.can_discard_revision,
        duplicate: d.can_duplicate,
        discardDraft: d.can_discard_draft,
        // As app.set_work_item_paper_ref decides it: a Draft never numbered, which they may edit now.
        editPaperRef: d.can_save_answers && d.draft_step && row.document_number === null,
      },
    };
  });
}

/** A visible item's Scopes and Sub-scopes, each Scope before its Sub-scopes. */
async function itemScopes(trx: Trx, workItemId: string): Promise<WorkItemDetail["scopes"]> {
  // work_item_scope_seen shows only a visible item's, as at a Send Back for everyone but the holder (RP-582);
  // every Project Member reads the Project's Scopes.
  const { rows } = await sql<{ id: string; parent_id: string | null; name: BilingualText }>`
    select s.id, s.parent_id, s.name
    from work_item_scope_seen ws
    join scope s on s.id = ws.scope_id
    left join scope parent on parent.id = s.parent_id
    where ws.work_item_id = ${workItemId}
    order by coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort
  `.execute(trx);
  return rows.map((s) => ({ id: s.id, parentId: s.parent_id, name: s.name }));
}

/** Whether item `w`'s Project is active (not closed). */
const projectActive = (w: RawBuilder<unknown>) => sql<boolean>`exists (select 1 from project p where p.id = ${w}.project_id and p.status = 'active')`;

/**
 * Whether the acting Member may duplicate a visible item `w` (RP-409): a Member of the
 * Participant that raised it, on an active Project. Creating the copy checks the rest.
 */
const canDuplicate = (w: RawBuilder<unknown>) => sql<boolean>`(
  coalesce(${w}.raised_by_participant_id in (select app.current_participant_ids()), false) and ${projectActive(w)})`;

/** Field types that hold Documents: a Duplicate copies those its own Participant uploaded. */
const documentFieldTypes: readonly string[] = ["attachments", "photos", "checklist"];

export type DuplicateResult = CreateWorkItemResult | { ok: false; reason: (typeof duplicateRefusals)[number] };

/**
 * Duplicate (RP-409, the List's row menu; visibility.md scenario RP-409-1): a new Draft of the
 * item's Type, created in one transaction as any new item is (createWorkItemIn: the latest Form
 * Version, the raiser's Draft Step, every check), with its Subject and only what the Member's own
 * Participant wrote: the answers of the sections editable at the Draft, as the Member reads them
 * (app.work_item_answers), whose last writer is of their own Participant (app.own_written_fields,
 * the Built-in Fields and checklists too), and whose field the latest Form still has with the
 * same type; and the Documents and photos their own Participant uploaded, of the Attachments
 * System Field and of those file, photo and checklist fields (app.copy_duplicate_documents: new
 * rows, uploaded now, whose files are copied here in the same transaction, so discarding either
 * item never touches the other's files). Never another Company's writes or files, even in a
 * section both may change, nor an Internal Note or the history: the new Draft keeps only which
 * item it came from, with no time (app.record_duplicate). The same `idempotencyKey` again, or
 * twice at once, answers with the same Draft while it stands; once it is discarded, a new one.
 * Refused alike, `duplicate_not_allowed`, to anyone but a Member of the raiser's Participant; not
 * found for an item they can't see.
 */
export async function duplicateWorkItem(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  idempotencyKey: string,
  now: Date,
  maxFileBytes: number = duplicateMaxFileBytes,
): Promise<DuplicateResult> {
  const madeFor = (trx: Trx) =>
    sql<{ id: string | null }>`select app.duplicate_of_key(${idempotencyKey}::uuid) as id`.execute(trx).then((r) => r.rows[0]?.id ?? null);
  try {
    return await duplicateIn({ db, files, memberId, workItemId, idempotencyKey, now, maxFileBytes, madeFor });
  } catch (error) {
    // Nothing was created, and no file copied: its files come to more than a Duplicate copies.
    if (error instanceof FilesTooLarge) return { ok: false, reason: "duplicate_files_too_large" };
    if (!isDuplicateRequest(error)) throw error;
    // The same request, at the same time, made its Draft first: answer with that one.
    const id = await withMember(db, memberId, madeFor);
    if (id === null) throw error;
    return { ok: true, id };
  }
}

/** The unique index that allows one live Draft per Duplicate request was hit. */
const isDuplicateRequest = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "23505" &&
  (error as { constraint?: unknown }).constraint === "work_item_duplicate_key";

/** Thrown inside the Duplicate's transaction, so its rows roll back, before any file is copied. */
class FilesTooLarge extends Error {}

function duplicateIn({
  db,
  files,
  memberId,
  workItemId,
  idempotencyKey,
  now,
  maxFileBytes,
  madeFor,
}: {
  db: Db;
  files: FileStore;
  memberId: string;
  workItemId: string;
  idempotencyKey: string;
  now: Date;
  maxFileBytes: number;
  /** The Draft this request already made, if any (app.duplicate_of_key). */
  madeFor: (trx: Trx) => Promise<string | null>;
}): Promise<DuplicateResult> {
  return refusedAsForbidden(() =>
    withFileCopies(files, (copy) => withMember(db, memberId, async (trx): Promise<DuplicateResult> => {
      const done = await madeFor(trx);
      if (done !== null) return { ok: true, id: done };
      const { rows } = await sql<{
        project_id: string;
        type_code: string;
        title: string;
        data: Record<string, unknown>;
        schema: unknown;
        can_duplicate: boolean;
        project_active: boolean;
      }>`
        select w.project_id, t.code as type_code, w.title, app.work_item_answers(w.id) as data, fv.schema,
          ${canDuplicate(sql.ref("w"))} as can_duplicate,
          ${projectActive(sql.ref("w"))} as project_active
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        join form_version fv on fv.id = w.form_version_id
        where w.id = ${workItemId} and app.sees_work_item(w.id)
      `.execute(trx);
      const item = rows[0];
      if (!item) return { ok: false, reason: "not_found" };
      if (!item.project_active) return { ok: false, reason: "project_closed" };
      if (!item.can_duplicate) return { ok: false, reason: "duplicate_not_allowed" };
      const pinned = formSchema.parse(item.schema);
      const answers = answersFromDb(pinned, item.data);
      const newForm = await newItemForm(trx, item.project_id, item.type_code);
      if (!newForm) return { ok: false, reason: "duplicate_not_allowed" };
      const { rows: own } = await sql<{ key: string }>`select app.own_written_fields(${workItemId}::uuid) as key`.execute(trx);
      const ownWritten = new Set(own.map((r) => r.key));
      const draft = await draftOf(trx, item.project_id, item.type_code);
      if (!draft) return { ok: false, reason: "duplicate_not_allowed" };
      const atDraft = formToFillAt(newForm, ...draft);
      const editable = new Set(atDraft.editableSections);
      const wasType = new Map(answerFields(pinned).map((f) => [f.key, f.type]));
      const atDraftFields = newForm.schema.sections
        .filter((s) => editable.has(s.key))
        .flatMap((s) => s.fields)
        .filter((f) => isAnswerField(f) && wasType.get(f.key) === f.type);
      // A file or photo field has no answer, only Documents; a checklist both.
      // A Checklist Template pick is kept only while it is still offered (the latest Version of an
      // active template): a Duplicate is a new request, and copies what the template says now (RP-651).
      const templates = await checklistTemplatesFor(trx, newForm.schema, item.project_id, null);
      const offered = (f: FormField) => f.type !== "checklist_template" || templates?.some((t) => t.offered && t.id === answers[f.key]);
      const kept = atDraftFields.filter((f) => answers[f.key] !== undefined && ownWritten.has(f.key) && offered(f));
      const fileKeys = atDraftFields.filter((f) => documentFieldTypes.includes(f.type)).map((f) => f.key);
      const created = await createWorkItemIn(
        trx,
        item.project_id,
        { type: item.type_code, title: item.title, answers: Object.fromEntries(kept.map((f) => [f.key, answers[f.key]])) },
        now,
      );
      if (!created.ok) return created;
      const { rows: recorded } = await sql<{ outcome: string }>`
        select app.record_duplicate(${created.id}::uuid, ${workItemId}::uuid, ${idempotencyKey}::uuid) as outcome
      `.execute(trx);
      // The Member made the Draft and sees both: anything else is a bug, and nothing is created.
      checkedOutcome(recorded[0]!.outcome, ["recorded"]);
      const { rows: copies } = await sql<{ storage_key: string; source_storage_key: string; size_bytes: string }>`
        select storage_key, source_storage_key, size_bytes
        from app.copy_duplicate_documents(${created.id}::uuid, ${workItemId}::uuid, ${fileKeys}::text[], ${now})
      `.execute(trx);
      if (copies.reduce((sum, c) => sum + Number(c.size_bytes), 0) > maxFileBytes) throw new FilesTooLarge();
      // If a file can't be copied, or the transaction then fails, the copies made are deleted and nothing is created.
      await copy(copies);
      return created;
    })),
  );
}

/** Delete (RP-409, the List's row menu): discards the Member's own Draft (app.discard_draft). */
export function discardDraft(db: Db, memberId: string, workItemId: string, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.discard_draft(${workItemId}::uuid, ${now}) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "discarded", discardDraftRefusals);
  });
}

const setPaperRefRefusals = ["not_found", "project_closed", "not_editable", "paper_ref_too_long", "paper_ref_taken"] as const;

/**
 * The Paper ref (RP-639, spec RP-631 story 27): the raiser sets or clears it while the item
 * is a Draft they may edit (app.set_work_item_paper_ref); one per Participant on the Project.
 */
export function setPaperRef(db: Db, memberId: string, workItemId: string, paperRef: string | null, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.set_work_item_paper_ref(${workItemId}::uuid, ${paperRef}, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "saved", setPaperRefRefusals);
  });
}

/**
 * Download (RP-409, owner decision B; visibility.md scenario RP-409-2): a Submitted item as it was
 * last shared, the same for every viewer who sees it, the holder's and the raiser's own Companies
 * included. Its Stage as every Company but the holder reads it (app.work_item_shared_stage), its
 * outcome, its answers as they last arrived (app.work_item_shared_answers, never in-progress ones),
 * the Built-in Fields from those answers, a `participant` answer by its Company, no person, its
 * Documents and Links as of the last arrival (never one added since; uploaders by Company only,
 * linked items by number and Subject only), and the shared events of its history by Company only,
 * with no Step. No Linked from: it differs between viewers. Null when the Member can't see it, or
 * before its first Submit.
 */
export function getSharedWorkItem(db: Db, memberId: string, workItemId: string, now: Date): Promise<SharedWorkItem | null> {
  return withMember(db, memberId, async (trx) => {
    const [row] = await visibleItems(trx, sql`w.id = ${workItemId}`);
    if (!row) return null;
    const { rows } = await sql<{
      project_id: string;
      form_version_id: string;
      revision_no: number;
      outcome: string | null;
      outcome_name: BilingualText | null;
      raised_by: BilingualText;
      submitted_at: Date | null;
      closed_at: Date | null;
      answers: Record<string, unknown> | null;
      schema: unknown;
      stage_key: string | null;
      stage_name: BilingualText | null;
      stage_category: WorkItemSummary["stage"]["category"] | null;
    }>`
      select w.project_id, w.form_version_id, w.revision_no, w.outcome, oc.name as outcome_name, raiser.legal_name as raised_by,
        w.submitted_at, w.closed_at, app.work_item_shared_answers(w.id) as answers, fv.schema,
        st.key as stage_key, st.name as stage_name, st.category as stage_category
      from work_item w
      join form_version fv on fv.id = w.form_version_id
      join work_item_type t on t.id = w.work_item_type_id
      join app.work_item_companies(w.id) raiser on raiser.participant_id = w.raised_by_participant_id
      left join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = app.work_item_shared_stage(w.id)
      left join outcome oc on oc.project_id = w.project_id and oc.work_item_type_id = w.work_item_type_id and oc.code = w.outcome
      where w.id = ${workItemId}
    `.execute(trx);
    const d = rows[0];
    if (!d || d.submitted_at === null || d.answers === null || d.stage_key === null) return null;
    const { rows: named } = await sql<{ field_key: string; company_name: BilingualText }>`
      select field_key, company_name from app.work_item_shared_named_answers(${workItemId}::uuid)
    `.execute(trx);
    const { rows: events } = await sql<{
      created_at: Date;
      audience: string;
      company_name: BilingualText | null;
      transition_label: BilingualText | null;
      outcome: string | null;
      remarks: string | null;
      document_number: string | null;
    }>`select created_at, audience, company_name, transition_label, outcome, remarks, document_number from app.work_item_history(${workItemId}::uuid)`.execute(
      trx,
    );
    const summary = toSummary(row, now);
    const schema = formSchema.parse(d.schema);
    // No `member` answer (the database leaves them out): the shared item names nobody, whoever reads it.
    const answers = answersFromDb(schema, d.answers);
    const builtIn = await sharedBuiltIns(trx, d.project_id, answers);
    if (!builtIn) return null;
    return {
      id: summary.id,
      projectId: summary.projectId,
      formVersionId: d.form_version_id,
      title: summary.title,
      documentNumber: summary.documentNumber,
      revisionNo: d.revision_no,
      type: summary.type,
      stage: { key: d.stage_key, name: d.stage_name!, category: d.stage_category! },
      outcome: d.outcome,
      outcomeName: d.outcome_name,
      ...builtIn,
      raisedBy: { companyName: d.raised_by },
      submissionDate: d.submitted_at.toISOString(),
      closedAt: d.closed_at?.toISOString() ?? null,
      answers,
      // A Company by its name; nobody's name, whoever reads it.
      namedAnswers: Object.fromEntries(named.map((n) => [n.field_key, { companyName: n.company_name, memberName: null }])),
      checklistCopies: await itemChecklistCopies(trx, workItemId),
      documents: await sharedDocuments(trx, workItemId),
      links: await sharedLinks(trx, workItemId),
      history: events
        .filter((e) => e.audience === "shared")
        .map((e) => ({
          at: e.created_at.toISOString(),
          transition: e.transition_label,
          companyName: e.company_name,
          outcome: e.outcome,
          remarks: e.remarks,
          documentNumber: e.document_number,
        })),
    };
  });
}

/** The Built-in Fields as the shared answers hold them (`trade`, `location` and `scopes` ids), by name. */
async function sharedBuiltIns(
  trx: Trx,
  projectId: string,
  answers: Record<string, unknown>,
): Promise<Pick<SharedWorkItem, "trade" | "location" | "scopes"> | null> {
  const idOf = (key: string) => (typeof answers[key] === "string" ? (answers[key] as string) : null);
  const scopeIds = Array.isArray(answers.scopes) ? answers.scopes.filter((s): s is string => typeof s === "string") : [];
  const value = async (valueId: string | null) => {
    if (valueId === null) return null;
    const { rows } = await sql<{ id: string; code: string; name: BilingualText }>`
      select v.id, v.code, v.name from dimension_value v
      join visibility_dimension d on d.id = v.dimension_id and d.project_id = ${projectId}
      where v.id = ${valueId}::uuid
    `.execute(trx);
    return rows[0] ?? null;
  };
  const trade = await value(idOf("trade"));
  if (!trade) return null;
  const { rows: scopes } = await sql<{ id: string; parent_id: string | null; name: BilingualText }>`
    select s.id, s.parent_id, s.name
    from scope s
    left join scope parent on parent.id = s.parent_id
    where s.project_id = ${projectId} and s.id = any(${scopeIds}::uuid[])
    order by coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort
  `.execute(trx);
  return { trade, location: await value(idOf("location")), scopes: scopes.map((s) => ({ id: s.id, parentId: s.parent_id, name: s.name })) };
}

/** A Submitted item's Documents as of its last arrival (app.work_item_shared_documents), each uploader by Company only. */
async function sharedDocuments(trx: Trx, workItemId: string): Promise<SharedWorkItem["documents"]> {
  const { rows } = await sql<{
    id: string;
    file_name: string;
    size_bytes: string;
    content_type: string;
    uploaded_at: Date;
    company_name: BilingualText;
    frozen: boolean;
    field_key: string | null;
    item_key: string | null;
    annotated_from_id: string | null;
    taken_at: Date | null;
    taken_latitude: number | null;
    taken_longitude: number | null;
  }>`
    select d.id, d.file_name, d.size_bytes, d.content_type, t.uploaded_at, co.legal_name as company_name,
      d.frozen_at is not null as frozen, d.field_key, d.item_key, d.annotated_from_id, d.taken_at, d.taken_latitude, d.taken_longitude
    from document d
    join app.document_times(${workItemId}::uuid) t on t.document_id = d.id
    join app.work_item_companies(d.work_item_id) co on co.participant_id = d.uploaded_by_participant_id
    where d.work_item_id = ${workItemId} and d.id in (select app.work_item_shared_documents(${workItemId}::uuid))
    order by t.uploaded_at, d.file_name, d.id
  `.execute(trx);
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    sizeBytes: Number(r.size_bytes),
    contentType: r.content_type,
    uploadedAt: r.uploaded_at.toISOString(),
    uploadedBy: { companyName: r.company_name, memberName: null },
    frozen: r.frozen,
    fieldKey: r.field_key,
    itemKey: r.item_key,
    annotatedFromId: r.annotated_from_id,
    takenAt: r.taken_at?.toISOString() ?? null,
    takenWhere: r.taken_latitude !== null && r.taken_longitude !== null ? { latitude: r.taken_latitude, longitude: r.taken_longitude } : null,
  }));
}

/** A Submitted item's Links as of its last arrival (app.work_item_shared_links). */
async function sharedLinks(trx: Trx, workItemId: string): Promise<SharedWorkItem["links"]> {
  const { rows } = await sql<{ id: string; kind: LinkKind; field_key: string | null; document_number: string; subject: string }>`
    select id, kind, field_key, document_number, subject from app.work_item_shared_links(${workItemId}::uuid)
  `.execute(trx);
  return rows.map((r) => ({ id: r.id, kind: r.kind, fieldKey: r.field_key, documentNumber: r.document_number, subject: r.subject }));
}

/** An item's per-field times as the acting Member who may save it reads them; locks the item when `lock`. */
async function fieldStamps(trx: Trx, workItemId: string, lock: boolean): Promise<FieldStamps> {
  const { rows } = await sql<{ times: FieldStamps | null }>`
    select app.work_item_field_times(${workItemId}::uuid, ${lock}) as times
  `.execute(trx);
  return rows[0]?.times ?? {};
}

/** The per-field times as `memberId` reads them: when, by whom (their own Company's people only), and whether by them. */
function fieldTimesFor(stamps: FieldStamps, memberId: string): WorkItemDetail["fieldTimes"] {
  return Object.fromEntries(Object.entries(stamps).map(([key, s]) => [key, { at: s.at, memberName: s.name, byMe: s.by === memberId }]));
}

/** Stamps the fields the last save changed (app.record_field_times). */
async function recordFieldTimes(trx: Trx, workItemId: string, now: Date): Promise<void> {
  const { rows } = await sql<{ outcome: string }>`select app.record_field_times(${workItemId}::uuid, ${now}) as outcome`.execute(trx);
  // Called right after a save the same Member was allowed, so anything else is a bug.
  if (rows[0]?.outcome !== "recorded") throw new Error(`record_field_times: ${rows[0]?.outcome}`);
}

/**
 * A visible item's `member` and `participant` answers as the acting Member may
 * read them (V14), and the keys of those naming someone or a Company they may
 * not see.
 */
async function namedAnswers(trx: Trx, workItemId: string): Promise<{ named: NamedAnswers; unnamed: Set<string> }> {
  const { rows } = await sql<{
    field_key: string;
    field_type: Extract<FormFieldType, "member" | "participant">;
    company_name: BilingualText | null;
    member_name: BilingualText | null;
  }>`select * from app.work_item_named_answers(${workItemId}::uuid)`.execute(trx);
  return {
    named: Object.fromEntries(rows.map((r) => [r.field_key, { companyName: r.company_name, memberName: r.member_name }])),
    unnamed: new Set(
      rows.filter((r) => !r.company_name || (r.field_type === "member" && !r.member_name)).map((r) => r.field_key),
    ),
  };
}

type ActionRow = {
  action: "pick_up" | "return_to_pool" | "transition";
  transition_key: string | null;
  label: BilingualText | null;
  transition_kind: WorkItemActions["transitions"][number]["kind"] | null;
  action_form: unknown;
  /** Whether it offers "Assign to" (WF-8). */
  offers_assign_to: boolean;
  /** Whether its Action Form offers the Participant field (RP-658). */
  picks_participant: boolean;
  /** Whether it may carry a Recommended Code (RP-433): a `send` from a Step that Recommends a Code. */
  may_recommend: boolean;
  /** The outcome it issues, if any. */
  outcome: string | null;
};

/**
 * What the acting Member may press on a visible item now, as app.work_item_actions
 * answers, each Transition with its Action Form from the item's pinned Workflow
 * Version. Only `transition_key` narrows them.
 */
async function actionRows(trx: Trx, workItemId: string, transitionKey?: string): Promise<ActionRow[]> {
  const { rows } = await sql<ActionRow>`
    select a.action, a.transition_key, a.label, a.transition_kind, tr.action_form, a.picks_participant,
      coalesce(tr.actions @> '[{"type": "offer_assign_to"}]', false) as offers_assign_to,
      coalesce(tr.kind = 'send' and src.outcome_mode = 'recommend_code', false) as may_recommend, tr.outcome
    from app.work_item_actions(${workItemId}::uuid) with ordinality a
    left join work_item w on w.id = ${workItemId}::uuid
    left join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
    left join workflow_step src on src.id = tr.from_step_id
    where ${transitionKey === undefined ? sql`true` : sql`a.action = 'transition' and a.transition_key = ${transitionKey}`}
    order by a.ordinality
  `.execute(trx);
  return rows;
}

/**
 * Whether the acting Member has a Signature in force (RP-85): the gate app.take_transition
 * checks, app.active_signature_id, which answers for the acting Member only.
 */
async function hasSignature(trx: Trx): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`select app.active_signature_id(app.current_member_id()) is not null as found`.execute(trx);
  return rows[0]!.found;
}

/**
 * Whether the acting Member's Company has a Stamp in force (RP-617): the gate app.take_transition
 * checks, app.member_company_has_stamp, which answers for the acting Member's own Company only.
 */
async function hasStamp(trx: Trx): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`select app.member_company_has_stamp(app.current_member_id()) as found`.execute(trx);
  return rows[0]!.found;
}

/** What the acting Member may press on a visible item now. */
async function actions(trx: Trx, workItemId: string): Promise<Omit<WorkItemActions, "saveAnswers" | "createRevision" | "createReplacement" | "discardRevision" | "duplicate" | "discardDraft" | "editPaperRef">> {
  const rows = await actionRows(trx, workItemId);
  const transitions = rows.filter((r) => r.action === "transition");
  const offered = await Promise.all(transitions.map((r) => (r.offers_assign_to ? assignees(trx, workItemId, r.transition_key!) : [])));
  const participants = await Promise.all(transitions.map((r) => (r.picks_participant ? participantsOffered(trx, workItemId, r.transition_key!) : [])));
  const recommendable = await Promise.all(
    transitions.map((r) => (r.may_recommend ? recommendableOutcomes(trx, workItemId, r.transition_key!) : [])),
  );
  const arrival = transitions.length > 0 ? await ownArrivalAnswers(trx, workItemId) : {};
  // The checklists each Transition's Screen takes (RP-86), read-only, and the code they propose (ADR 0025).
  const checklists = await Promise.all(transitions.map((r) => transitionChecklists(trx, workItemId, parseActionForm(r.action_form))));
  const proposed = checklistsPropose(checklists.flat());
  const recommended = transitions.length > 0 ? await arrivalRecommendedCode(trx, workItemId) : null;
  return {
    pickUp: rows.some((r) => r.action === "pick_up"),
    returnToPool: rows.some((r) => r.action === "return_to_pool"),
    // No Signature, no Transition (RP-85): the pop-up asks for one before the Action Form.
    signatureRequired: transitions.length > 0 && !(await hasSignature(trx)),
    // No Stamp, no Transition (RP-617): the message says so before the Action Form.
    stampRequired: transitions.length > 0 && !(await hasStamp(trx)),
    transitions: transitions.map((r, i) => {
      const actionForm = parseActionForm(r.action_form);
      const prefill = actionForm ? prefilled(actionForm, arrival) : {};
      return {
        key: r.transition_key!,
        label: r.label!,
        kind: r.transition_kind!,
        actionForm,
        ...(offered[i]!.length > 0 ? { assignTo: offered[i] } : {}),
        ...(participants[i]!.length > 0 ? { participants: participants[i] } : {}),
        ...(recommendable[i]!.length > 0 ? { recommendCode: recommendable[i] } : {}),
        ...(Object.keys(prefill).length > 0 ? { prefill } : {}),
        ...(checklists[i]!.length > 0 ? { checklists: checklists[i] } : {}),
        ...(checklists[i]!.length > 0 && r.outcome === proposed ? { proposed: true as const } : {}),
      };
    }),
    ...(recommended ? { recommendedCode: recommended } : {}),
  };
}

/**
 * The Action Form answers of the move that brought the item to its current Step, when
 * that move was inside the viewer's own Participant (an `internal` event, which only its
 * own Participant reads, V5): the shared and internal answers of the reply that handed
 * it to them, such as the Consultant Engineer's verification for the Manager's Code
 * (workflow-engine.md §5.7, RP-437). Empty when the item arrived from another
 * Participant, whose answers are never carried over.
 */
async function ownArrivalAnswers(trx: Trx, workItemId: string): Promise<Record<string, unknown>> {
  const { rows } = await sql<{ answers: Record<string, unknown> | null }>`
    with arrival as (
      -- The last move the viewer reads. They hold the item, so it moved to their Step:
      -- by their own Participant (internal), or by another (a Submit, shared).
      select e.seq, e.transition_id, e.audience_participant_id, e.payload - 'document_number' - 'outcome' as answers
      from work_item_event e
      where e.work_item_id = ${workItemId}::uuid and e.type = 'transition' and e.audience = 'internal'
        -- Taken by that Participant itself: the Owner's review writes the moves between the
        -- Consultant and the Owner internal to each (ADR 0022), and those cross Participants.
        and e.actor_participant_id = e.audience_participant_id
        and e.seq = (
          select max(m.seq) from work_item_event m
          where m.work_item_id = e.work_item_id and m.type in ('transition', 'issue_code') and m.to_step_id is not null
        )
    )
    select coalesce((
      -- Its internal answers: the event app.take_transition writes for the same Transition
      -- just before it, after the move before it, internal to the same Participant.
      select i.payload -> 'answers' from work_item_event i
      where i.work_item_id = ${workItemId}::uuid and i.type = 'internal_answers'
        and i.transition_id = a.transition_id
        and i.audience = 'internal' and i.audience_participant_id = a.audience_participant_id
        and i.seq < a.seq
        and i.seq > coalesce((
          select max(p.seq) from work_item_event p
          where p.work_item_id = i.work_item_id and p.type in ('transition', 'issue_code') and p.seq < a.seq
        ), 0)
    ), '{}'::jsonb) || a.answers as answers
    from arrival a
  `.execute(trx);
  return rows[0]?.answers ?? {};
}

/** `answers`' values for the answer fields `actionForm` asks, by key. */
function prefilled(actionForm: FormSchema, answers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    answerFields(actionForm)
      .filter((f) => f.key in answers)
      .map((f) => [f.key, answers[f.key]]),
  );
}

/**
 * The Recommended Code (RP-433): the outcomes the acting Member may recommend when
 * taking `transitionKey` (app.transition_recommendable_outcomes): the Type's closing
 * outcomes, from a Step that Recommends a Code, to their own Participant's next reviewer.
 */
async function recommendableOutcomes(trx: Trx, workItemId: string, transitionKey: string): Promise<{ code: string; name: BilingualText }[]> {
  const { rows } = await sql<{ code: string; name: BilingualText }>`
    select code, name from app.transition_recommendable_outcomes(${workItemId}::uuid, ${transitionKey})
  `.execute(trx);
  return rows;
}

/**
 * "Assign to" (WF-8): the Members the acting Member may pick as the next holder
 * when taking `transitionKey` (app.transition_assignees): their own Participant's,
 * who may hold the next Step; none when that Step is another Participant's.
 */
async function assignees(trx: Trx, workItemId: string, transitionKey: string): Promise<{ memberId: string; name: BilingualText }[]> {
  const { rows } = await sql<{ member_id: string; full_name: BilingualText }>`
    select member_id, full_name from app.transition_assignees(${workItemId}::uuid, ${transitionKey})
  `.execute(trx);
  return rows.map((r) => ({ memberId: r.member_id, name: r.full_name }));
}

/**
 * The Participant field (RP-658): the Participants covering the item that the acting Member
 * must pick one of when taking `transitionKey` (app.participants_offered), by Company name
 * only (V14).
 */
async function participantsOffered(trx: Trx, workItemId: string, transitionKey: string): Promise<{ participantId: string; companyName: BilingualText }[]> {
  const { rows } = await sql<{ participant_id: string; company_name: BilingualText }>`
    select o.participant_id, o.company_name
    from work_item w
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = ${transitionKey}
    cross join lateral app.participants_offered(w.id, tr.id) o
    where w.id = ${workItemId}::uuid
  `.execute(trx);
  return rows.map((r) => ({ participantId: r.participant_id, companyName: r.company_name }));
}

const transitionRefusals = [
  "not_found",
  "item_closed",
  "project_closed",
  "not_holder",
  "transition_not_available",
  "forbidden",
  "invalid_action_form",
  "next_step_unavailable",
  "no_step_pool",
  "idempotency_key_reused",
  "form_not_checked",
  "no_route",
  "assignee_not_offered",
  "participant_not_picked",
  "participant_not_offered",
  "action_not_allowed",
  "recommended_code_not_offered",
  "not_confirmed",
  "no_signature",
  "no_stamp",
] as const;
export type TakeTransitionResult =
  | { ok: true }
  | AnswersRefused
  | { ok: false; reason: "invalid_action_form"; errors: FieldError[] }
  | { ok: false; reason: "validation_failed"; message: BilingualText }
  | { ok: false; reason: (typeof transitionRefusals)[number] };

/** A Transition of the item's pinned Workflow Version, as taking it checks it. */
type TransitionToTake = { kind: WorkItemActions["transitions"][number]["kind"]; action_form: unknown; rules: TransitionRules };

/**
 * The Transition that taking `key` with `answers` takes on a visible item: itself,
 * or among Transitions sharing its label and source Step, the one the answers
 * route to (app.transition_route, §4). Null when they route to none, or to several.
 */
async function routedTransition(trx: Trx, workItemId: string, key: string, answers: unknown): Promise<TransitionToTake | null> {
  const { rows } = await sql<{ kind: TransitionToTake["kind"]; action_form: unknown; rules: unknown }>`
    select tr.kind, tr.action_form, tr.rules
    from work_item w
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id
      and tr.key = app.transition_route(w.id, ${key}, ${JSON.stringify(answers)}::jsonb)
    where w.id = ${workItemId}
  `.execute(trx);
  const row = rows[0];
  if (!row) return null;
  return { kind: row.kind, action_form: row.action_form, rules: storedTransitionRules(row.rules) };
}

/** A refused Validate rule, with its message in English and Arabic (WF-7). */
function validationRefused(rule: Validation, form: FormSchema, actionForm: FormSchema | null): TakeTransitionResult {
  const fields = [...formFields(form), ...(actionForm ? formFields(actionForm) : [])];
  const fieldLabel = (key: string) => {
    const field = fields.find((f) => f.key === key);
    return field && "label" in field ? field.label : null;
  };
  return { ok: false, reason: "validation_failed", message: validationMessage(rule, fieldLabel) };
}

/**
 * How many confirmed files each `attachments` or `photos` field of a visible
 * item has, by field key, and each checklist item's photos, by
 * checklistItemFilesKey (RLS shows only confirmed, unremoved Documents), for
 * leaving Draft. An annotated copy is not a file of its own (RP-656). A reply
 * Screen's files are not the Form's (ADR 0024).
 */
async function fieldFileCounts(trx: Trx, workItemId: string): Promise<Record<string, number>> {
  const { rows } = await sql<{ field_key: string; item_key: string | null; files: number }>`
    select field_key, item_key, count(*)::integer as files from document
    where work_item_id = ${workItemId} and field_key is not null and annotated_from_id is null and not reply
    group by field_key, item_key
  `.execute(trx);
  return Object.fromEntries(rows.map((r) => [r.item_key === null ? r.field_key : checklistItemFilesKey(r.field_key, r.item_key), r.files]));
}

/**
 * How many confirmed files each reply Screen's field holds that no Transition took yet,
 * by field key (ADR 0024): what the Transition about to be taken would take. Only the
 * Participant holding the item sees them (RLS), and only it may take its Transitions.
 */
async function replyFileCounts(trx: Trx, workItemId: string): Promise<Record<string, number>> {
  const { rows } = await sql<{ field_key: string; files: number }>`
    select field_key, count(*)::integer as files from document
    where work_item_id = ${workItemId} and reply and reply_event_id is null and annotated_from_id is null
    group by field_key
  `.execute(trx);
  return Object.fromEntries(rows.map((r) => [r.field_key, r.files]));
}

/**
 * The holder of the item's current Step takes one of its Transitions, in one
 * transaction (workflow-engine.md §5.1), with their Internal Note if they wrote
 * one. Its Action Form's answers are checked against its schema in complete
 * mode (a Transition with none takes no answers) and stored in its event
 * (RP-300). The same idempotency key again applies nothing. Moving on (not a
 * Return or a cancel) by a Member who may save the answers needs the sections
 * naming the Step being left complete, their `attachments` fields' files
 * included: otherwise it is refused with the per-field errors. Sections another
 * Participant fills later are not checked (RP-304). Every Transition needs the
 * Member's confirmation from its pop-up (`confirmed`, ADR 0017): without it,
 * an item they see is refused `not_confirmed`, and nothing is written.
 *
 * Its rules (WF-7): a label shared by several Transitions takes the one the
 * answers route to, whose Action Form is the one checked; a Restrict that doesn't
 * hold is refused like a Transition that isn't there, by the database; a Validate
 * rule that doesn't hold is refused with its message. "Form complete" is checked
 * here, over the whole Form as the Member reads it; the database checks the others.
 *
 * A code raising Snags from failed check items (RP-577) gives them the items' photos: their
 * files are copied here, in the same transaction (withFileCopies).
 */
export function takeTransition(
  db: Db,
  files: FileStore,
  memberId: string,
  workItemId: string,
  input: Required<TakeTransitionRequest>,
  now: Date,
): Promise<TakeTransitionResult> {
  return withFileCopies(files, (copy) => withMember(db, memberId, (trx) => takeTransitionIn(trx, copy, memberId, workItemId, input, now)));
}

/**
 * takeTransition inside a transaction the acting Member's already runs in: the
 * same checks and the same app.take_transition, so a command taking several
 * Transitions at once (Submit Package, RP-638) takes each exactly as a single one.
 * `copy` copies the files of the photos the Snags it raises take (RP-577).
 */
export async function takeTransitionIn(
  trx: Trx,
  copy: CopyFiles,
  memberId: string,
  workItemId: string,
  input: Required<TakeTransitionRequest>,
  now: Date,
): Promise<TakeTransitionResult> {
  // The Member's key first, the lock app.take_transition takes (RP-600): a request
  // with the same key waits for this one to commit, so its checks below read the
  // item as moved and it reaches the replay, rather than being refused (no_route).
  // Taken before the 404: it is the Member's own key, not the item's.
  await sql`select pg_advisory_xact_lock(hashtextextended(${memberId}::uuid::text || '/' || ${input.idempotencyKey}::uuid::text, 0))`.execute(trx);
  const pinned = await pinnedForm(trx, workItemId);
  if (!pinned) return { ok: false, reason: "not_found" };
  // A hidden item is the plain 404 first; then nothing moves unconfirmed.
  if (!input.confirmed) return { ok: false, reason: "not_confirmed" };
  // Only a Transition the Member may take is checked here, so anyone else is told why
  // they can't act (by the database), never what its Action Form or the Form lacks.
  const [taking] = await actionRows(trx, workItemId, input.transition);
  // No Signature, no Transition (RP-85): refused before its answers are checked, as the
  // pop-up asks for one before its Action Form. Only for a Transition they may take.
  if (taking && !(await hasSignature(trx))) return { ok: false, reason: "no_signature" };
  // No Stamp, no Transition (RP-617): right after the Signature, as the database checks it.
  if (taking && !(await hasStamp(trx))) return { ok: false, reason: "no_stamp" };
  const routed = taking ? await routedTransition(trx, workItemId, input.transition, input.answers) : null;
  if (taking && !routed) return { ok: false, reason: "no_route" };
  const actionForm = routed ? parseActionForm(routed.action_form) : null;
  // Its Action Form's answers, as the Form's are checked when leaving Draft. The
  // database takes only keys the schema has, with what it always requires.
  let answers: Record<string, unknown> = input.answers;
  if (routed) {
    if (actionForm) {
      // A Screen's file fields count the files waiting in them, which the Transition takes (ADR 0024).
      const checked = validateAnswers(actionForm, input.answers, "complete", {
        optionLists: await optionListsFor(trx, actionForm),
        files: await replyFileCounts(trx, workItemId),
      });
      if (!checked.ok) return { ok: false, reason: "invalid_action_form", errors: checked.errors };
      answers = checked.answers;
    } else if (Object.keys(input.answers).length > 0) {
      return { ok: false, reason: "invalid_action_form", errors: Object.keys(input.answers).map((key) => ({ key, code: "unknown_field" })) };
    }
  }
  // The Form's answers as they stand, checked as complete: a retired option they
  // hold stays valid (held).
  const checkFormComplete = async () =>
    validateAnswers(pinned.form.schema, pinned.data, "complete", {
      scopes: await projectScopes(trx, pinned.projectId),
      optionLists: await optionListsFor(trx, pinned.form.schema),
      held: pinned.data,
      suppliers: await suppliersFor(trx, pinned.form.schema, pinned.projectId),
      checklistTemplates: await checklistTemplatesFor(trx, pinned.form.schema, pinned.projectId, workItemId, pinned.data),
      files: await fieldFileCounts(trx, workItemId),
    });
  // Moving on by a Member who may save the answers now (other than a cancel or a Return),
  // and every Submit whoever takes it (the PM, who may not save), needs the required
  // fields of the sections naming the Step being left (form-engine.md §4); the database
  // refuses answers that weren't checked.
  if (pinned.canSave || routed?.kind === "submit") {
    const checked = await checkFormComplete();
    const missing = checked.ok ? [] : errorsInSections(pinned.form.schema, pinned.sectionsAtStep, checked.errors);
    // A cancel, a Return or a Send Back takes the item back: nothing has to be complete.
    const kind = routed?.kind;
    const back = kind === "cancel" || (kind != null && backwardKinds.includes(kind));
    if (routed && !back && missing.length > 0) {
      return { ok: false, reason: "form_incomplete", errors: missing };
    }
  }
  // A reply Screen's checklist (RP-86): moving on from a Step that fills it checks it as a
  // required section, and the Transition whose Screen takes it checks it too, naming the items.
  if (routed) {
    const back = routed.kind === "cancel" || backwardKinds.includes(routed.kind);
    const incomplete = await incompleteReplyChecklists(trx, workItemId, { leaving: !back, actionForm });
    if (incomplete.leaving.length > 0) return { ok: false, reason: "form_incomplete", errors: incomplete.leaving };
    if (incomplete.taken.length > 0) return { ok: false, reason: "invalid_action_form", errors: incomplete.taken };
  }
  // Validate "the Form is complete": the whole Form, as this Member reads it.
  const validate = routed?.rules.validate ?? [];
  const formComplete = validate.find((v) => v.type === "form_complete");
  if (formComplete && !(await checkFormComplete()).ok) {
    return validationRefused(formComplete, pinned.form.schema, actionForm);
  }
  // A pick with no copy yet (a Revision's, carried from the item it revises) gets it before
  // the item moves on, so it never leaves the raiser without its checklist (RP-651).
  if (routed && pinned.canSave) await syncChecklists(trx, pinned.form.schema, workItemId, now);
  const { rows } = await sql<{ outcome: string }>`
    select app.take_transition(
      ${workItemId}::uuid, ${input.transition}, ${JSON.stringify(answers)}::jsonb, ${input.internalNote},
      ${pinned.dataSha256}::bytea, ${input.idempotencyKey}::uuid, ${now}, ${input.assignTo}::uuid,
      ${input.recommendedCode}::text, ${input.participant}::uuid) as outcome
  `.execute(trx);
  // A Validate rule the database found not holding, by its place in `validate`.
  const failed = /^validation_failed:(\d+)$/.exec(rows[0]!.outcome);
  if (failed) {
    const rule = (routed ?? (await routedTransition(trx, workItemId, input.transition, answers)))?.rules.validate?.[Number(failed[1])];
    if (rule) return validationRefused(rule, pinned.form.schema, actionForm);
  }
  const result = commandResult(rows[0]!.outcome, "applied", transitionRefusals);
  // The "before" photos of the Snags a code raised from failed check items (RP-577): none on a replay.
  if (result.ok) {
    const { rows: copies } = await sql<FileCopy>`
      select storage_key, source_storage_key from app.raised_document_copies(${workItemId}::uuid)
    `.execute(trx);
    await copy(copies);
  }
  return result;
}

const saveAnswersRefusals = [
  "not_found",
  "project_closed",
  "not_editable",
  "trade_required",
  "value_not_found",
  "outside_visibility",
  "number_part_fixed",
  "target_not_found",
] as const;
export type SaveAnswersResult =
  | { ok: true; saved: SavedAnswers | null }
  | AnswersRefused
  | { ok: false; reason: (typeof saveAnswersRefusals)[number] };

/**
 * Save draft: the raiser's Participant saves the answers so far, in Draft or one
 * of its internal Steps, or, after Submit, the Participant holding a Step a Form
 * Section names saves that section (RP-304), checked in draft mode against its
 * pinned Form Version (required fields may be empty). After Draft, the database
 * records each change as a field-level diff in the saver's own history, and
 * everyone else reads the answers as they arrived until the item leaves it (V19).
 *
 * With `basedOn`, each field another Member changed since is kept as theirs
 * (mergeFieldAnswers) and reported, with every field's time, in `saved`.
 */
export function saveAnswers(
  db: Db,
  memberId: string,
  workItemId: string,
  input: SaveAnswersRequest,
  now: Date,
): Promise<SaveAnswersResult> {
  return withMember(db, memberId, async (trx): Promise<SaveAnswersResult> => {
    // Locked first, so the merge is against exactly what this save overwrites.
    const before = await fieldStamps(trx, workItemId, true);
    const pinned = await pinnedForm(trx, workItemId);
    if (!pinned) return { ok: false, reason: "not_found" };
    // Who may save, and when, before what is wrong with the answers.
    if (!pinned.canSave) return { ok: false, reason: "not_editable" };
    const merge = input.basedOn
      ? mergeFieldAnswers({ stored: pinned.data, stamps: before, basedOn: input.basedOn, submitted: input.answers, memberId })
      : null;
    const answers = merge ? merge.merged : input.answers;
    // And into which Form Sections: one that isn't editable now must come back as it is (form-engine.md §4).
    if (changedOutside(pinned.form.schema, new Set(pinned.toFill.editableSections), pinned.data, answers).length > 0) {
      return { ok: false, reason: "not_editable" };
    }
    const checked = validateAnswers(pinned.form.schema, answers, "draft", {
      scopes: await projectScopes(trx, pinned.projectId),
      offered: await offeredFor(trx, pinned.form.schema, pinned.projectId, workItemId, pinned.data),
      optionLists: await optionListsFor(trx, pinned.form.schema),
      held: pinned.data,
      linkable: await linkableIds(trx, pinned.form.schema, pinned.projectId, workItemId, answers, pinned.data),
      suppliers: await suppliersFor(trx, pinned.form.schema, pinned.projectId),
      checklistTemplates: await checklistTemplatesFor(trx, pinned.form.schema, pinned.projectId, workItemId, pinned.data),
    });
    if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
    // The Checklist Template picks, and so their copies, are fixed at the first Submit (RP-651),
    // after a Send Back that lets the raiser edit the Form too; a Trade change would clear one.
    if (pinned.submitted && changedChecklistTemplates(pinned.form.schema, pinned.data, checked.answers).length > 0) {
      return { ok: false, reason: "not_editable" };
    }
    const stored = storedAnswers(answersToDb(pinned.form.schema, checked.answers));
    const { rows } = await sql<{ outcome: string }>`
      select app.save_work_item_answers(
        ${workItemId}::uuid, ${stored.data}::jsonb, ${stored.tradeId}::uuid, ${stored.locationId}::uuid,
        ${stored.scopeIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    const result = commandResult(rows[0]!.outcome, "saved", saveAnswersRefusals);
    if (!result.ok) return result;
    await syncChecklists(trx, pinned.form.schema, workItemId, now);
    await recordFieldTimes(trx, workItemId, now);
    if (!merge) return { ok: true, saved: null };
    const after = await fieldStamps(trx, workItemId, false);
    return {
      ok: true,
      saved: {
        fieldTimes: fieldTimesFor(after, memberId),
        keptFromOthers: merge.kept.map((k) => ({ field: k.field, value: k.value, at: k.at, memberName: k.name })),
      },
    };
  });
}

const pickUpRefusals = ["not_found", "item_closed", "project_closed", "already_picked_up", "forbidden"] as const;
const returnToPoolRefusals = ["not_found", "item_closed", "project_closed", "not_holder", "pool_of_one"] as const;
export type PickUpResult = { ok: true } | { ok: false; reason: (typeof pickUpRefusals)[number] };
export type ReturnToPoolResult = { ok: true } | { ok: false; reason: (typeof returnToPoolRefusals)[number] };

/** A Member of its Step Pool picks up the item's pooled Step; of two at once, one wins (§5.2). */
export function pickUpStep(db: Db, memberId: string, workItemId: string, now: Date): Promise<PickUpResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.pick_up_step(${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "picked_up", pickUpRefusals);
  });
}

/** The Member who picked up the item's Step gives it back to its pool. */
export function returnToPoolStep(db: Db, memberId: string, workItemId: string, now: Date): Promise<ReturnToPoolResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.return_to_pool_step(${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "returned_to_pool", returnToPoolRefusals);
  });
}

/**
 * A visible item's history as the Member may see it (internal events only within
 * their own Participant), or null when they can't see the item.
 */
export function getWorkItemHistory(db: Db, memberId: string, workItemId: string): Promise<WorkItemHistory | null> {
  return withMember(db, memberId, async (trx) => {
    const visible = await trx.selectFrom("work_item").select("id").where("id", "=", workItemId).executeTakeFirst();
    if (!visible) return null;
    const { rows } = await sql<{
      seq: number;
      type: WorkItemHistory["events"][number]["type"];
      created_at: Date;
      audience: "shared" | "internal";
      company_name: BilingualText | null;
      member_name: BilingualText | null;
      transition_label: BilingualText | null;
      from_step_name: BilingualText | null;
      to_step_name: BilingualText | null;
      reason: string | null;
      remarks: string | null;
      document_number: string | null;
      outcome: WorkItemOutcome | null;
      internal_note: string | null;
      recommended_code: string | null;
      changes: { field: string; old: unknown; new: unknown }[] | null;
      handover: WorkItemHistory["events"][number]["handover"];
      answers: Record<string, unknown> | null;
      /** The Action Form the answers were given in (its Transition's, as its Workflow Version pinned it; read project-wide like the Workflow, V20), so the page labels them. */
      action_form: unknown;
    }>`select * from app.work_item_history(${workItemId}::uuid)`.execute(trx);
    // The import that created it (RP-645, story 35), for its importing Company's Members only, with no time.
    const { rows: imports } = await sql<{ import_id: string; file_name: string; member_name: BilingualText | null; by_rabaed: boolean }>`
      select import_id, file_name, member_name, by_rabaed from app.register_import_of_work_item(${workItemId}::uuid)
    `.execute(trx);
    const imported = imports[0];
    // The reply files each Transition took (ADR 0024), as RLS shows them: they freeze at its event's
    // time (the history names no event id). The Owner's review writes one Transition as two events
    // of the same time, each read by one Participant, and both name the same files.
    const { rows: taken } = await sql<{ id: string; frozen_at: Date }>`
      select id, frozen_at from document
      where work_item_id = ${workItemId} and reply and reply_event_id is not null
      order by frozen_at, id
    `.execute(trx);
    const filesOf = (r: { type: string; created_at: Date }) => {
      if (r.type !== "transition" && r.type !== "issue_code") return {};
      const files = taken.filter((d) => d.frozen_at.getTime() === r.created_at.getTime()).map((d) => d.id);
      return files.length > 0 ? { files } : {};
    };
    return {
      ...(imported
        ? { imported: { importId: imported.import_id, fileName: imported.file_name, byRabaed: imported.by_rabaed, memberName: imported.member_name } }
        : {}),
      events: rows.map((r) => ({
        ...(r.answers ? { answersForm: parseActionForm(r.action_form ?? null) } : {}),
        seq: r.seq,
        type: r.type,
        at: r.created_at.toISOString(),
        audience: r.audience,
        by: { companyName: r.company_name, memberName: r.member_name },
        transition: r.transition_label,
        fromStep: r.from_step_name,
        toStep: r.to_step_name,
        reason: r.reason,
        remarks: r.remarks,
        documentNumber: r.document_number,
        outcome: r.outcome,
        internalNote: r.internal_note,
        recommendedCode: r.recommended_code,
        changes: r.changes,
        handover: r.handover,
        answers: r.answers,
        ...filesOf(r),
      })),
    };
  });
}
