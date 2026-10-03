import { withMember, type Database, type Db } from "@rabaed/db";
import {
  formSchema,
  stepAgeWeeks,
  validateAnswers,
  type BilingualText,
  type CreateWorkItemRequest,
  type FieldError,
  type FormVersion,
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
// complete mode before leaving Draft. The database decides who may write them and
// when, and lets an item leave Draft only with the answers checked here.
//
// The Built-in Fields `trade`, `location` and `scopes` are answers like any other
// to the Member, but are stored where visibility reads them: the database
// functions take them apart from the Form's own answers, and app.work_item_answers
// puts them back (RP-270).

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

/** Checked answers as the database functions take them: the Form's own, and the Built-in Fields apart. */
function storedAnswers({ trade, location, scopes, ...data }: Record<string, unknown>) {
  return {
    data: JSON.stringify(data),
    tradeId: (trade as string | undefined) ?? null,
    locationId: (location as string | undefined) ?? null,
    scopeIds: (scopes as string[] | undefined) ?? [],
  };
}

/** A visible item's Form as the acting Member may work with it. */
type PinnedForm = {
  form: FormVersion;
  /** Its Project, whose Scopes the validator checks `scopes` against. */
  projectId: string;
  /** The answers now, Built-in Fields included. */
  data: Record<string, unknown>;
  /** Their hash, as app.take_transition compares it. */
  dataSha256: Buffer;
  /** The viewer sees it in Draft. */
  inDraft: boolean;
  /** They may save its answers now (app.can_save_answers). */
  canSave: boolean;
};

/** A visible item's pinned Form Version and its answers; null when the Member can't see the item. */
async function pinnedForm(trx: Trx, workItemId: string): Promise<PinnedForm | null> {
  const { rows } = await sql<
    FormVersionRow & {
      project_id: string;
      data: Record<string, unknown>;
      data_sha256: Buffer;
      in_draft: boolean;
      can_save: boolean;
    }
  >`
    select v.id, v.version_no, v.schema, w.project_id, app.work_item_answers(w.id) as data,
      app.answers_sha256(w.id) as data_sha256, st.category = 'draft' as in_draft, app.can_save_answers(w.id) as can_save
    from work_item w
    join form_version v on v.id = w.form_version_id
    join work_item_type t on t.id = w.work_item_type_id
    cross join lateral app.step_as_seen(w.id) seen
    join stage st on st.module_key = t.module_key and st.key = seen.stage_key and st.project_id is null
    where w.id = ${workItemId}
  `.execute(trx);
  const r = rows[0];
  if (!r) return null;
  return {
    form: toFormVersion(r),
    projectId: r.project_id,
    data: r.data,
    dataSha256: r.data_sha256,
    inDraft: r.in_draft,
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
      const checked = validateAnswers(form.schema, input.answers, "draft", { scopes: await projectScopes(trx, projectId) });
      if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
      const stored = storedAnswers(checked.answers);
      const { rows } = await sql<{ outcome: string; work_item_id: string | null }>`
        select outcome, work_item_id from app.create_work_item(
          ${projectId}::uuid, ${input.type}, ${input.title}, ${form.id}::uuid, ${stored.data}::jsonb,
          ${stored.tradeId}::uuid, ${stored.locationId}::uuid, ${now}, ${stored.scopeIds}::uuid[])
      `.execute(trx);
      const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...createWorkItemRefusals]);
      const { work_item_id } = rows[0]!;
      return outcome === "created" ? { ok: true, id: work_item_id! } : { ok: false, reason: outcome };
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
    // work_item_scope shows only a visible item's; every Project Member reads the Project's Scopes.
    const { rows: scopes } = await sql<{ id: string; parent_id: string | null; name: BilingualText }>`
      select s.id, s.parent_id, s.name
      from work_item_scope ws
      join scope s on s.id = ws.scope_id
      left join scope parent on parent.id = s.parent_id
      where ws.work_item_id = ${workItemId}
      order by coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort
    `.execute(trx);
    return {
      ...toSummary(row, now),
      formVersionId: d.form_version_id,
      answers: d.data,
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
 * The holder of the item's current Step takes one of its Transitions, in one
 * transaction (workflow-engine.md §5.1), with their Internal Note if they wrote
 * one. The same idempotency key again applies nothing. Leaving Draft needs a
 * complete Form: otherwise it is refused with the per-field errors.
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
    // Leaving Draft (other than cancelling it) needs a complete Form; the database refuses
    // answers that weren't checked. Only a Transition the Member may take is checked here,
    // so anyone else is told why they can't act, not what the Form lacks.
    if (pinned.inDraft) {
      const { rows: takeable } = await sql<{ transition_kind: string }>`
        select transition_kind from app.work_item_actions(${workItemId}::uuid)
        where action = 'transition' and transition_key = ${input.transition}
      `.execute(trx);
      const scopes = await projectScopes(trx, pinned.projectId);
      const checked = validateAnswers(pinned.form.schema, pinned.data, "complete", { scopes });
      if (takeable.some((t) => t.transition_kind !== "cancel") && !checked.ok) {
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
] as const;
export type SaveAnswersResult = { ok: true } | AnswersRefused | { ok: false; reason: (typeof saveAnswersRefusals)[number] };

/**
 * Save draft: the raiser's Participant saves a Draft's answers so far, checked
 * in draft mode against its pinned Form Version (required fields may be empty).
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
    const checked = validateAnswers(pinned.form.schema, input.answers, "draft", { scopes: await projectScopes(trx, pinned.projectId) });
    if (!checked.ok) return { ok: false, reason: "invalid_answers", errors: checked.errors };
    const stored = storedAnswers(checked.answers);
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
      })),
    };
  });
}
