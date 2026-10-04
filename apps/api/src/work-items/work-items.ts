import { withMember, type Database, type Db } from "@rabaed/db";
import {
  formFields,
  formSchema,
  isHiddenLinkChoice,
  offeredChoices,
  stepAgeWeeks,
  checklistItemFilesKey,
  validateAnswers,
  type BilingualText,
  type CreateWorkItemRequest,
  type FieldError,
  type FormChoices,
  type FormSchema,
  type FormFieldType,
  type FormVersion,
  type LinkSearchQuery,
  type LinkSearchResults,
  type NamedAnswers,
  type SaveAnswersRequest,
  type ScopeChoice,
  type TakeTransitionRequest,
  type WorkItemActions,
  type WorkItemDetail,
  type WorkItemHistory,
  type WorkItemList,
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
  /** The full answers' hash, as app.take_transition compares it; null unless the answers are open. */
  dataSha256: Buffer | null;
  /** Its answers are open to the raiser: Draft and the raiser's internal Steps (app.answers_open). */
  answersOpen: boolean;
  /** They may save its answers now (app.can_save_answers). */
  canSave: boolean;
};

/** A visible item's pinned Form Version and its answers; null when the Member can't see the item. */
async function pinnedForm(trx: Trx, workItemId: string): Promise<PinnedForm | null> {
  const { rows } = await sql<
    FormVersionRow & {
      project_id: string;
      data: Record<string, unknown>;
      data_sha256: Buffer | null;
      answers_open: boolean;
      can_save: boolean;
    }
  >`
    select v.id, v.version_no, v.schema, w.project_id, app.work_item_answers(w.id) as data,
      app.answers_sha256(w.id) as data_sha256, app.answers_open(w.id) as answers_open, app.can_save_answers(w.id) as can_save
    from work_item w
    join form_version v on v.id = w.form_version_id
    where w.id = ${workItemId}
  `.execute(trx);
  const r = rows[0];
  if (!r) return null;
  const form = toFormVersion(r);
  return {
    form,
    projectId: r.project_id,
    data: answersFromDb(form.schema, r.data),
    dataSha256: r.data_sha256,
    answersOpen: r.answers_open,
    canSave: r.can_save,
  };
}

/**
 * The Form for a new item of the Rabaed Default Type `typeCode` on one of the
 * Member's Projects: the latest published Version. Null when it isn't one of
 * their Projects, or there is no such Type.
 */
export function getNewWorkItemForm(db: Db, memberId: string, projectId: string, typeCode: string): Promise<FormVersion | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    return onProject ? latestForm(trx, typeCode) : null;
  });
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

/** The Form Version a visible item is pinned to; null when the Member can't see the item. */
export function getWorkItemForm(db: Db, memberId: string, workItemId: string): Promise<FormVersion | null> {
  return withMember(db, memberId, async (trx) => (await pinnedForm(trx, workItemId))?.form ?? null);
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
  step_entered_at: Date;
};

/** The visible Work Items matching `where`, as list rows. */
function visibleItems(trx: Trx, where: RawBuilder<unknown>) {
  return sql<SummaryRow>`
    select w.id, w.project_id, t.code as type_code, t.name as type_name, w.title, w.document_number,
      st.key as stage_key, st.name as stage_name, st.category as stage_category,
      tv.id as trade_id, tv.code as trade_code, tv.name as trade_name,
      lv.id as location_id, lv.code as location_code, lv.name as location_name,
      seen.entered_at as step_entered_at
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
    stepEnteredAt: r.step_entered_at.toISOString(),
    stepAgeWeeks: stepAgeWeeks(r.step_entered_at, now),
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
      return { ok: true, id: work_item_id! };
    }),
  );
}

/**
 * The Submittals of one of the Member's Projects that they can see, with every
 * Stage and how many of those items are in it; null when it isn't one of their Projects.
 */
export function listWorkItems(db: Db, memberId: string, projectId: string, now: Date): Promise<WorkItemList | null> {
  return withMember(db, memberId, async (trx) => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const items = (await visibleItems(trx, sql`w.project_id = ${projectId}`)).map((r) => toSummary(r, now));
    const stages = await trx
      .selectFrom("stage")
      .select(["key", "name", "category"])
      .where("module_key", "=", "submittals")
      .where("project_id", "is", null)
      .orderBy("sort")
      .execute();
    return {
      stages: stages.map((s) => ({ ...s, count: items.filter((i) => i.stage.key === s.key).length })),
      items,
    };
  });
}

/** `text` as a LIKE pattern that matches it anywhere, with its own %, _ and \ taken literally. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Link search (visibility.md "Link search", scenario 29): the Project's items
 * whose Document Number or Subject contains `q`, whatever the case, newest
 * first, one page at a time. Only items the Member sees (RLS, the list's own
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
      order by w.created_at desc, w.id desc
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
      created_at: Date;
      step_key: string;
      step_name: BilingualText;
      raised_by: BilingualText;
      held_by: BilingualText | null;
      holder_name: BilingualText | null;
      outcome: WorkItemOutcome | null;
      closed_at: Date | null;
      can_save_answers: boolean;
    }>`
      select app.work_item_answers(w.id) as data, w.form_version_id, w.created_at, w.outcome, w.closed_at, s.key as step_key, s.name as step_name,
        raiser.legal_name as raised_by, holder.legal_name as held_by, m.full_name as holder_name,
        app.can_save_answers(w.id) as can_save_answers
      from work_item w
      cross join lateral app.step_as_seen(w.id) seen
      join workflow_step s on s.id = seen.step_id
      join app.work_item_companies(w.id) raiser on raiser.participant_id = w.raised_by_participant_id
      left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
      left join app.work_item_companies(w.id) holder on holder.participant_id = a.participant_id
      -- member's own RLS shows only the viewer's own Company's people (V14).
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
    return {
      ...toSummary(row, now),
      formVersionId: d.form_version_id,
      // Another Company's people, and a Company the viewer may not see, are never identified, not even by an id (V14, V15).
      answers: Object.fromEntries(Object.entries(answers).filter(([key]) => !unnamed.has(key))),
      namedAnswers: named,
      scopes: scopes.map((s) => ({ id: s.id, parentId: s.parent_id, name: s.name })),
      step: { key: d.step_key, name: d.step_name },
      raisedBy: { companyName: d.raised_by },
      heldBy: d.held_by ? { companyName: d.held_by, memberName: d.holder_name } : null,
      outcome: d.outcome,
      closedAt: d.closed_at?.toISOString() ?? null,
      createdAt: d.created_at.toISOString(),
      actions: { ...(await actions(trx, workItemId)), saveAnswers: d.can_save_answers },
    };
  });
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

/** What the acting Member may press on a visible item now, as app.work_item_actions answers. */
async function actions(trx: Trx, workItemId: string): Promise<Omit<WorkItemActions, "saveAnswers">> {
  const { rows } = await sql<{
    action: "claim" | "release" | "transition";
    transition_key: string | null;
    label: BilingualText | null;
    transition_kind: WorkItemActions["transitions"][number]["kind"] | null;
  }>`select * from app.work_item_actions(${workItemId}::uuid)`.execute(trx);
  return {
    claim: rows.some((r) => r.action === "claim"),
    release: rows.some((r) => r.action === "release"),
    transitions: rows
      .filter((r) => r.action === "transition")
      .map((r) => ({
        key: r.transition_key!,
        label: r.label!,
        kind: r.transition_kind!,
        needsReason: r.transition_kind === "return",
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
  "reason_required",
  "next_step_unavailable",
  "no_step_pool",
  "idempotency_key_reused",
  "form_not_checked",
] as const;
export type TakeTransitionResult = { ok: true } | AnswersRefused | { ok: false; reason: (typeof transitionRefusals)[number] };

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
 * one. The same idempotency key again applies nothing. Moving on while the
 * answers are open to the raiser (leaving Draft, and the Submit) needs a
 * complete Form, its `attachments` fields' files included: otherwise it is
 * refused with the per-field errors.
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
    // Moving on while the answers are open (other than a cancel or a Return) needs a complete
    // Form; the database refuses answers that weren't checked. Only a Transition the Member
    // may take is checked here, so anyone else is told why they can't act, not what the Form lacks.
    if (pinned.answersOpen) {
      const { rows: takeable } = await sql<{ transition_kind: string }>`
        select transition_kind from app.work_item_actions(${workItemId}::uuid)
        where action = 'transition' and transition_key = ${input.transition}
      `.execute(trx);
      const scopes = await projectScopes(trx, pinned.projectId);
      // What is saved is checked as it stands: a retired option it holds stays valid (held).
      const checked = validateAnswers(pinned.form.schema, pinned.data, "complete", {
        scopes,
        optionLists: await optionListsFor(trx, pinned.form.schema),
        held: pinned.data,
        files: await fieldFileCounts(trx, workItemId),
      });
      if (takeable.some((t) => t.transition_kind !== "cancel" && t.transition_kind !== "return") && !checked.ok) {
        return { ok: false, reason: "form_incomplete", errors: checked.errors };
      }
    }
    const { rows } = await sql<{ outcome: string }>`
      select app.take_transition(
        ${workItemId}::uuid, ${input.transition}, ${input.reason}, ${input.internalNote},
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
export type SaveAnswersResult = { ok: true } | AnswersRefused | { ok: false; reason: (typeof saveAnswersRefusals)[number] };

/**
 * Save draft: the raiser's Participant saves the answers so far, in Draft or one
 * of its internal Steps, checked in draft mode against its pinned Form Version
 * (required fields may be empty). After Draft, the database records each change
 * as a field-level diff in the raiser's history.
 */
export function saveAnswers(
  db: Db,
  memberId: string,
  workItemId: string,
  input: SaveAnswersRequest,
  now: Date,
): Promise<SaveAnswersResult> {
  return withMember(db, memberId, async (trx): Promise<SaveAnswersResult> => {
    const pinned = await pinnedForm(trx, workItemId);
    if (!pinned) return { ok: false, reason: "not_found" };
    // Who may save, and when, before what is wrong with the answers.
    if (!pinned.canSave) return { ok: false, reason: "not_editable" };
    const checked = validateAnswers(pinned.form.schema, input.answers, "draft", {
      scopes: await projectScopes(trx, pinned.projectId),
      offered: await offeredFor(trx, pinned.form.schema, pinned.projectId, workItemId, pinned.data),
      optionLists: await optionListsFor(trx, pinned.form.schema),
      held: pinned.data,
      linkable: await linkableIds(trx, pinned.form.schema, pinned.projectId, workItemId, input.answers, pinned.data),
    });
    if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
    const stored = storedAnswers(answersToDb(pinned.form.schema, checked.answers));
    const { rows } = await sql<{ outcome: string }>`
      select app.save_work_item_answers(
        ${workItemId}::uuid, ${stored.data}::jsonb, ${stored.tradeId}::uuid, ${stored.locationId}::uuid,
        ${stored.scopeIds}::uuid[], ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "saved", saveAnswersRefusals);
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
        documentNumber: r.document_number,
        outcome: r.outcome,
        internalNote: r.internal_note,
        changes: r.changes,
      })),
    };
  });
}
