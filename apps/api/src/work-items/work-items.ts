import { withMember, type Database, type Db } from "@rabaed/db";
import {
  backwardKinds,
  changedOutside,
  editableSections,
  errorsInSections,
  formFields,
  mergeFieldAnswers,
  formSchema,
  sectionsFilledBy,
  isHiddenLinkChoice,
  offeredChoices,
  parseActionForm,
  stepAgeWeeks,
  checklistItemFilesKey,
  validateAnswers,
  type BilingualText,
  type CreateWorkItemRequest,
  type FieldError,
  type FieldStamps,
  type FormChoices,
  type FormSchema,
  type FormFieldType,
  type FormToFill,
  type FormVersion,
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
  type WorkItemSummary,
} from "@rabaed/domain";
import { sql, type RawBuilder, type Transaction } from "kysely";
import { refusedAsForbidden, type Forbidden } from "../db-error.ts";
import { isUuid } from "../http-error.ts";
import { readOptionLists } from "../option-lists/option-lists.ts";
import { checkedOutcome, commandResult } from "../outcomes.ts";

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

/** The latest published Version of the Form of the Rabaed Default Type `typeCode`, if there is one. */
async function latestForm(trx: Trx, typeCode: string): Promise<FormVersion | null> {
  const { rows } = await sql<FormVersionRow>`
    select id, version_no, schema from form_version where id = app.latest_form_version(${typeCode})
  `.execute(trx);
  return rows[0] ? toFormVersion(rows[0]) : null;
}

/** The Project's Scopes and Sub-scopes, which the validator checks `scopes` against. */
async function projectScopes(trx: Trx, projectId: string): Promise<ScopeChoice[]> {
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
async function optionListsFor(trx: Trx, schema: FormSchema) {
  const uses = formFields(schema).some(
    (f) => f.type === "option_list" || (f.type === "table" && f.columns.some((c) => c.type === "option_list")),
  );
  return uses ? readOptionLists(trx) : undefined;
}

/** Checked answers as the database functions take them: the Form's own, and the Built-in Fields apart. */
function storedAnswers({ trade, location, scopes, ...data }: Record<string, unknown>) {
  return {
    data: JSON.stringify(data),
    tradeId: (trade as string | undefined) ?? null,
    locationId: (location as string | undefined) ?? null,
    scopeIds: (scopes as string[] | undefined) ?? [],
  };
}

/** The keys of a Form's link questions. */
const linkQuestionKeys = (schema: FormSchema) => formFields(schema).flatMap((f) => (f.type === "work_item_ref" ? [f.key] : []));

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
 * The ids given in the link questions of `answers` that the acting Member may
 * choose: those Link search could have offered them (Submitted, visible, in the
 * Project, not `workItemId` itself), and those the field already holds in
 * `held` (as they may read it) while they still see them, even if they have
 * gone back to a Draft. Undefined when the Form has no link question.
 */
async function linkableIds(
  trx: Trx,
  schema: FormSchema,
  projectId: string,
  workItemId: string | null,
  answers: unknown,
  held: Readonly<Record<string, unknown>> = {},
): Promise<Set<string> | undefined> {
  const keys = linkQuestionKeys(schema);
  if (keys.length === 0) return undefined;
  const given: Record<string, unknown> = typeof answers === "object" && answers !== null ? { ...answers } : {};
  const idsIn = (items: unknown) => (Array.isArray(items) ? items : []).filter((v): v is string => typeof v === "string" && isUuid(v));
  const ids = keys.flatMap((key) => idsIn(given[key]));
  if (ids.length === 0) return new Set();
  const kept = keys.flatMap((key) => idsIn(held[key]).filter((id) => idsIn(given[key]).includes(id)));
  const { rows } = await sql<{ id: string }>`
    select t.id from work_item t
    where t.id = any(${ids}::uuid[]) and t.project_id = ${projectId} and t.id is distinct from ${workItemId}::uuid
      and (app.work_item_submitted(t.id) or (t.id = any(${kept}::uuid[]) and app.sees_work_item(t.id)))
  `.execute(trx);
  return new Set(rows.map((r) => r.id));
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
  /** The answers' hash, as app.take_transition compares it; null unless they may save now. */
  dataSha256: Buffer | null;
  /** They may save its answers now (app.can_save_answers). */
  canSave: boolean;
  /** The Form as they may fill it now: the sections they may change, and who fills the others. */
  toFill: FormToFill;
};

/** A visible item's pinned Form Version and its answers; null when the Member can't see the item. */
async function pinnedForm(trx: Trx, workItemId: string): Promise<PinnedForm | null> {
  const { rows } = await sql<
    FormVersionRow & {
      project_id: string;
      data: Record<string, unknown>;
      data_sha256: Buffer | null;
      workflow_version_id: string;
      step_key: string;
    }
  >`
    select v.id, v.version_no, v.schema, w.project_id, app.work_item_answers(w.id) as data,
      app.answers_sha256(w.id) as data_sha256,
      w.workflow_version_id, s.key as step_key
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
  const form = toFormVersion(r);
  // app.answers_sha256 is null exactly when app.can_save_answers is false: one permission check, not two.
  const canSave = r.data_sha256 !== null;
  const steps = await workflowSteps(trx, r.workflow_version_id);
  return {
    form,
    projectId: r.project_id,
    data: answersFromDb(form.schema, r.data),
    dataSha256: r.data_sha256,
    canSave,
    toFill: formToFillAt(form, steps, { step: r.step_key, canSave }),
  };
}

/** A Workflow Version's Steps as Form Sections are matched to them, and the name of each base role's Project Role. */
type WorkflowSteps = { steps: WorkflowStepHolder[]; roleNames: ReadonlyMap<string, BilingualText> };

/** The Steps of the Workflow Version `workflowVersionId`. Definitions, which every Member reads. */
async function workflowSteps(trx: Trx, workflowVersionId: string): Promise<WorkflowSteps> {
  const { rows } = await sql<{ key: string; role: string | null; draft: boolean; role_name: BilingualText | null }>`
    -- A Draft as app.is_draft_step (which the app role can't call) tells it: a Rabaed Stage of category draft, in any Module.
    select s.key, s.actor_rule ->> 'base_role' as role,
      exists (select 1 from stage st where st.owner_kind = 'rabaed' and st.key = s.stage_key and st.category = 'draft') as draft,
      r.name as role_name
    from workflow_step s
    -- Projects use the Rabaed Default Project Roles for now.
    left join project_role r on r.owner_kind = 'rabaed' and r.base_role = s.actor_rule ->> 'base_role'
    where s.workflow_version_id = ${workflowVersionId}
    order by s.key
  `.execute(trx);
  return {
    steps: rows.map(({ key, role, draft }) => ({ key, role, draft })),
    roleNames: new Map(rows.flatMap((r) => (r.role && r.role_name ? [[r.role, r.role_name] as const] : []))),
  };
}

/** `form` as it is filled in at `step`: the sections editable there, and who fills the sections another Participant fills. */
function formToFillAt(form: FormVersion, { steps, roleNames }: WorkflowSteps, at: SectionEditContext): FormToFill {
  const filledBy = Object.entries(sectionsFilledBy(form.schema, steps)).flatMap(([key, role]) => {
    const name = roleNames.get(role);
    return name ? [[key, name] as const] : [];
  });
  return { ...form, editableSections: [...editableSections(form.schema, steps, at)], filledBy: Object.fromEntries(filledBy) };
}

/**
 * The Form for a new item of the Rabaed Default Type `typeCode` on one of the
 * Member's Projects: the latest published Version, as it is filled in at the
 * Draft of the Workflow Version it would start on (draftOf). Null when it isn't one of
 * their Projects, or there is no such Type.
 */
export function getNewWorkItemForm(db: Db, memberId: string, projectId: string, typeCode: string): Promise<FormToFill | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const form = await latestForm(trx, typeCode);
    return form && formToFillAt(form, ...(await draftOf(trx, projectId, typeCode)));
  });
}

/**
 * The Steps of the Workflow a new item of `typeCode` raised by the acting Member
 * on `projectId` starts on, and its Draft: the latest published Version of the
 * Workflow bound for their Participant, as app.create_work_item resolves it (RP-426).
 */
async function draftOf(trx: Trx, projectId: string, typeCode: string): Promise<[WorkflowSteps, SectionEditContext]> {
  const { rows } = await sql<{ type_id: string; workflow_version_id: string | null }>`
    select t.id as type_id, app.new_item_workflow_version(${projectId}::uuid, t.id, (
      select pm.participant_id from project_member pm
      where pm.project_id = ${projectId}::uuid and pm.member_id = app.current_member_id() and pm.status = 'active'
        and pm.participant_id in (select app.current_participant_ids())
    )) as workflow_version_id
    from work_item_type t
    where t.owner_kind = 'rabaed' and t.code = ${typeCode}
  `.execute(trx);
  const r = rows[0];
  if (!r?.workflow_version_id) throw new Error(`Work Item Type ${typeCode} has no published Workflow Version`);
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
async function formChoices(trx: Trx, projectId: string, workItemId: string | null): Promise<FormChoices> {
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
    join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
    join visibility_dimension td on td.project_id = w.project_id and td.kind = 'trade'
    join work_item_dimension_value tdv on tdv.work_item_id = w.id and tdv.dimension_id = td.id
    join dimension_value tv on tv.id = tdv.dimension_value_id
    join visibility_dimension ld on ld.project_id = w.project_id and ld.kind = 'location'
    left join work_item_dimension_value ldv on ldv.work_item_id = w.id and ldv.dimension_id = ld.id
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
  return refusedAsForbidden(() =>
    withMember(db, memberId, async (trx): Promise<CreateWorkItemResult> => {
      const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
      if (!onProject) return { ok: false, reason: "not_found" };
      const form = await latestForm(trx, input.type);
      if (!form) return { ok: false, reason: "type_not_found" };
      // Only the Form Sections editable at the Draft take answers (form-engine.md §4).
      const atDraft = formToFillAt(form, ...(await draftOf(trx, projectId, input.type)));
      if (changedOutside(form.schema, new Set(atDraft.editableSections), {}, input.answers).length > 0) {
        return { ok: false, reason: "not_editable" };
      }
      const checked = validateAnswers(form.schema, input.answers, "draft", {
        scopes: await projectScopes(trx, projectId),
        offered: await offeredFor(trx, form.schema, projectId, null),
        optionLists: await optionListsFor(trx, form.schema),
        linkable: await linkableIds(trx, form.schema, projectId, null, input.answers),
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
      await recordFieldTimes(trx, work_item_id!, now);
      return { ok: true, id: work_item_id! };
    }),
  );
}

/** `text` as a LIKE pattern that matches it anywhere, with its own %, _ and \ taken literally. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Link search (visibility.md "Link search", scenario 79): the Project's items
 * whose Document Number or Subject contains `q`, whatever the case, the latest
 * Submitted first (the Submission Date, which every caller who sees an item may
 * read; never when its Draft was started), one page at a time. Only items the Member sees (RLS, the list's own
 * path) that have been Submitted (app.work_item_submitted): never a Draft or an
 * item in internal review. One row more than the page is read only to tell
 * whether there is a next page; there is no total, so nothing counts hidden
 * matches. Null when it isn't one of the Member's Projects.
 */
export function searchLinkTargets(db: Db, memberId: string, projectId: string, query: LinkSearchQuery): Promise<LinkSearchResults | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const pattern = containsPattern(query.q);
    const { rows } = await sql<{ id: string; document_number: string; title: string }>`
      select w.id, w.document_number, w.title
      from work_item w
      where w.project_id = ${projectId} and app.work_item_submitted(w.id)
        and (w.document_number ilike ${pattern} or w.title ilike ${pattern})
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
      outcome: WorkItemOutcome | null;
      closed_at: Date | null;
      can_save_answers: boolean;
      revision_no: number;
      versions_changed: boolean;
      can_create_revision: boolean;
      can_discard_revision: boolean;
      workflow_name: BilingualText;
      workflow_version_no: number;
    }>`
      select app.work_item_answers(w.id) as data, w.form_version_id, app.work_item_creation_date(w.id) as creation_date,
        wf.name as workflow_name, wf.version_no as workflow_version_no,
        w.submitted_at, w.outcome, w.closed_at, s.key as step_key, s.name as step_name,
        raiser.legal_name as raised_by, holder.legal_name as held_by, m.full_name as holder_name,
        app.can_save_answers(w.id) as can_save_answers, w.revision_no, app.revision_versions_changed(w.id) as versions_changed,
        app.can_create_revision(w.id) as can_create_revision, app.can_discard_revision(w.id) as can_discard_revision
      from work_item w
      cross join lateral app.step_as_seen(w.id) seen
      join workflow_step s on s.id = seen.step_id
      -- Its Workflow's name and Version, for whoever sees the item, whatever Workflow rows they read (V20).
      left join lateral app.work_item_workflow(w.id) wf on true
      join app.work_item_companies(w.id) raiser on raiser.participant_id = w.raised_by_participant_id
      left join app.work_item_holder(w.id) a on true
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      -- Only the viewer's own Participant's holder is named, and member's own RLS shows only their own Company's people (V14).
      left join member m on m.id = a.assignee_member_id
      where w.id = ${workItemId}
    `.execute(trx);
    const d = rows[0]!;
    const { schema } = await trx.selectFrom("form_version").select("schema").where("id", "=", d.form_version_id).executeTakeFirstOrThrow();
    const answers = answersFromDb(formSchema.parse(schema), d.data);
    // work_item_scope shows only a visible item's; every Project Member reads the Project's Scopes.
    const { rows: scopes } = await sql<{ id: string; parent_id: string | null; name: BilingualText }>`
      select s.id, s.parent_id, s.name
      from work_item_scope ws
      join scope s on s.id = ws.scope_id
      left join scope parent on parent.id = s.parent_id
      where ws.work_item_id = ${workItemId}
      order by coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort
    `.execute(trx);
    const { named, unnamed } = await namedAnswers(trx, workItemId);
    const stamps = await fieldStamps(trx, workItemId, false);
    const { rows: dropped } = await sql<{ field_key: string; label: BilingualText }>`
      select field_key, label from app.revision_dropped_fields(${workItemId}::uuid)
    `.execute(trx);
    const { rows: auto } = await sql<{ autosave: boolean }>`select app.answers_autosave(${workItemId}::uuid) as autosave`.execute(trx);
    return {
      ...toSummary(row, now),
      formVersionId: d.form_version_id,
      workflow: { name: d.workflow_name, versionNo: d.workflow_version_no },
      revisionNo: d.revision_no,
      versionsChanged: d.versions_changed,
      droppedFields: dropped.map((f) => ({ key: f.field_key, label: f.label })),
      // Another Company's people, and a Company the viewer may not see, are never identified, not even by an id (V14, V15).
      answers: Object.fromEntries(Object.entries(answers).filter(([key]) => !unnamed.has(key))),
      namedAnswers: named,
      fieldTimes: fieldTimesFor(stamps, memberId),
      autosave: auto[0]!.autosave,
      scopes: scopes.map((s) => ({ id: s.id, parentId: s.parent_id, name: s.name })),
      step: { key: d.step_key, name: d.step_name },
      raisedBy: { companyName: d.raised_by },
      heldBy: d.held_by ? { companyName: d.held_by, memberName: d.holder_name } : null,
      outcome: d.outcome,
      closedAt: d.closed_at?.toISOString() ?? null,
      // When the Draft was started is audit only, shown to nobody (visibility.md "Creation Date", scenario 61).
      creationDate: d.creation_date?.toISOString() ?? null,
      submissionDate: d.submitted_at?.toISOString() ?? null,
      actions: {
        ...(await actions(trx, workItemId)),
        saveAnswers: d.can_save_answers,
        createRevision: d.can_create_revision,
        discardRevision: d.can_discard_revision,
      },
    };
  });
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
  action: "claim" | "release" | "transition";
  transition_key: string | null;
  label: BilingualText | null;
  transition_kind: WorkItemActions["transitions"][number]["kind"] | null;
  action_form: unknown;
};

/**
 * What the acting Member may press on a visible item now, as app.work_item_actions
 * answers, each Transition with its Action Form from the item's pinned Workflow
 * Version. Only `transition_key` narrows them.
 */
async function actionRows(trx: Trx, workItemId: string, transitionKey?: string): Promise<ActionRow[]> {
  const { rows } = await sql<ActionRow>`
    select a.action, a.transition_key, a.label, a.transition_kind, tr.action_form
    from app.work_item_actions(${workItemId}::uuid) with ordinality a (action, transition_key, label, transition_kind, n)
    left join work_item w on w.id = ${workItemId}::uuid
    left join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.key = a.transition_key
    where ${transitionKey === undefined ? sql`true` : sql`a.action = 'transition' and a.transition_key = ${transitionKey}`}
    order by a.n
  `.execute(trx);
  return rows;
}

/** What the acting Member may press on a visible item now. */
async function actions(trx: Trx, workItemId: string): Promise<Omit<WorkItemActions, "saveAnswers" | "createRevision" | "discardRevision">> {
  const rows = await actionRows(trx, workItemId);
  return {
    claim: rows.some((r) => r.action === "claim"),
    release: rows.some((r) => r.action === "release"),
    transitions: rows
      .filter((r) => r.action === "transition")
      .map((r) => ({
        key: r.transition_key!,
        label: r.label!,
        kind: r.transition_kind!,
        actionForm: parseActionForm(r.action_form),
      })),
  };
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
  "not_confirmed",
] as const;
export type TakeTransitionResult =
  | { ok: true }
  | AnswersRefused
  | { ok: false; reason: "invalid_action_form"; errors: FieldError[] }
  | { ok: false; reason: (typeof transitionRefusals)[number] };

/**
 * How many confirmed files each `attachments` or `photos` field of a visible
 * item has, by field key, and each checklist item's photos, by
 * checklistItemFilesKey (RLS shows only confirmed, unremoved Documents), for
 * leaving Draft.
 */
async function fieldFileCounts(trx: Trx, workItemId: string): Promise<Record<string, number>> {
  const { rows } = await sql<{ field_key: string; item_key: string | null; files: number }>`
    select field_key, item_key, count(*)::integer as files from document
    where work_item_id = ${workItemId} and field_key is not null
    group by field_key, item_key
  `.execute(trx);
  return Object.fromEntries(rows.map((r) => [r.item_key === null ? r.field_key : checklistItemFilesKey(r.field_key, r.item_key), r.files]));
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
 */
export function takeTransition(
  db: Db,
  memberId: string,
  workItemId: string,
  input: Required<TakeTransitionRequest>,
  now: Date,
): Promise<TakeTransitionResult> {
  return withMember(db, memberId, async (trx): Promise<TakeTransitionResult> => {
    const pinned = await pinnedForm(trx, workItemId);
    if (!pinned) return { ok: false, reason: "not_found" };
    // A hidden item is the plain 404 first; then nothing moves unconfirmed.
    if (!input.confirmed) return { ok: false, reason: "not_confirmed" };
    // Only a Transition the Member may take is checked here, so anyone else is told why
    // they can't act (by the database), never what its Action Form or the Form lacks.
    const [taking] = await actionRows(trx, workItemId, input.transition);
    // Its Action Form's answers, as the Form's are checked when leaving Draft. The
    // database takes only keys the schema has, with what it always requires.
    let answers: Record<string, unknown> = input.answers;
    if (taking) {
      const actionForm = parseActionForm(taking.action_form);
      if (actionForm) {
        const checked = validateAnswers(actionForm, input.answers, "complete", { optionLists: await optionListsFor(trx, actionForm) });
        if (!checked.ok) return { ok: false, reason: "invalid_action_form", errors: checked.errors };
        answers = checked.answers;
      } else if (Object.keys(input.answers).length > 0) {
        return { ok: false, reason: "invalid_action_form", errors: Object.keys(input.answers).map((key) => ({ key, code: "unknown_field" })) };
      }
    }
    // Moving on by a Member who may save the answers now (other than a cancel or a Return)
    // needs the required fields of the sections naming the Step being left (form-engine.md §4);
    // the database refuses answers that weren't checked.
    if (pinned.canSave) {
      const scopes = await projectScopes(trx, pinned.projectId);
      // What is saved is checked as it stands: a retired option it holds stays valid (held).
      const checked = validateAnswers(pinned.form.schema, pinned.data, "complete", {
        scopes,
        optionLists: await optionListsFor(trx, pinned.form.schema),
        held: pinned.data,
        files: await fieldFileCounts(trx, workItemId),
      });
      const missing = checked.ok ? [] : errorsInSections(pinned.form.schema, pinned.toFill.editableSections, checked.errors);
      // A cancel, a Return or a Send Back takes the item back: nothing has to be complete.
      const kind = taking?.transition_kind;
      const back = kind === "cancel" || (kind != null && backwardKinds.includes(kind));
      if (taking && !back && missing.length > 0) {
        return { ok: false, reason: "form_incomplete", errors: missing };
      }
    }
    const { rows } = await sql<{ outcome: string }>`
      select app.take_transition(
        ${workItemId}::uuid, ${input.transition}, ${JSON.stringify(answers)}::jsonb, ${input.internalNote},
        ${pinned.dataSha256}::bytea, ${input.idempotencyKey}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "applied", transitionRefusals);
  });
}

const saveAnswersRefusals = [
  "not_found",
  "project_closed",
  "not_editable",
  "trade_required",
  "value_not_found",
  "outside_visibility",
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
    });
    if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
    const stored = storedAnswers(answersToDb(pinned.form.schema, checked.answers));
    const { rows } = await sql<{ outcome: string }>`
      select app.save_work_item_answers(
        ${workItemId}::uuid, ${stored.data}::jsonb, ${stored.tradeId}::uuid, ${stored.locationId}::uuid,
        ${stored.scopeIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    const result = commandResult(rows[0]!.outcome, "saved", saveAnswersRefusals);
    if (!result.ok) return result;
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

const claimRefusals = ["not_found", "item_closed", "project_closed", "already_claimed", "forbidden"] as const;
const releaseRefusals = ["not_found", "item_closed", "project_closed", "not_holder"] as const;
export type ClaimResult = { ok: true } | { ok: false; reason: (typeof claimRefusals)[number] };
export type ReleaseResult = { ok: true } | { ok: false; reason: (typeof releaseRefusals)[number] };

/** A Member of its Step Pool claims the item's pooled Step; of two at once, one wins (§5.2). */
export function claimStep(db: Db, memberId: string, workItemId: string, now: Date): Promise<ClaimResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.claim_step(${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "claimed", claimRefusals);
  });
}

/** The Member who claimed the item's Step gives it back to its pool. */
export function releaseStep(db: Db, memberId: string, workItemId: string, now: Date): Promise<ReleaseResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.release_step(${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "released", releaseRefusals);
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
      changes: { field: string; old: unknown; new: unknown }[] | null;
    }>`select * from app.work_item_history(${workItemId}::uuid)`.execute(trx);
    return {
      events: rows.map((r) => ({
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
        changes: r.changes,
      })),
    };
  });
}
