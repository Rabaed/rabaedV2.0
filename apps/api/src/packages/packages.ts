import { withMember, type Db } from "@rabaed/db";
import {
  packageNumber,
  type BilingualText,
  type PackageComments,
  type PackageDetail,
  type PackageItem,
  type PackageNotReadyItem,
  type PackageNotReadyReason,
  type PackageStatus,
  type PackageSummary,
  type SubmitPackageRequest,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "@rabaed/db";
import { checkedOutcome, commandResult } from "../outcomes.ts";
import { workItemRowsById } from "../work-items/query.ts";
import { bulkOffers } from "../work-items/bulk-transitions.ts";
import { allOrNothing, itemsById, lockWorkItems, Rollback, takeEach } from "../work-items/several-transitions.ts";

// Packages (spec RP-616; RP-636 an Open Package). Reads go through the package
// table's row-level security (app.sees_package) and column grants; a Package's
// items through app.package_items, which gives only the items the viewer sees, so
// a list or count never includes one they don't. Writes go through the app.*
// functions of the open_package migration, each re-checking the caller's access:
// a Package they don't see is 'not_found', exactly like a made-up id.
//
// Submit Package (RP-638) takes each item's own Submit through takeTransitionIn,
// the single Submit's path, in one transaction (several-transitions.ts, with the lock
// order); the database moves the Package to In Progress (submit_package migration).
//
// The board and the Package page (RP-641): every Member who sees one of a
// Package's items sees the Package (app.sees_package), its owner by Company name,
// and its counts and items of the ones they see only (app.package_summary,
// app.package_items); only the owning Participant may change it. Bulk Transitions
// (RP-646) and the packageId filter (RP-647) read the items the same way.

type Trx = Transaction<Database>;

const createRefusals = ["not_found", "project_closed", "invalid_name"] as const;
export type CreatePackageResult =
  | { ok: true; id: string; number: string }
  | { ok: false; reason: (typeof createRefusals)[number] };

const renameRefusals = ["not_found", "project_closed", "invalid_name"] as const;
const discardRefusals = ["not_found", "project_closed", "package_not_open"] as const;
const addRefusals = ["not_found", "project_closed", "item_not_offered", "in_another_package", "not_editable"] as const;
const removeRefusals = ["not_found", "project_closed", "package_not_open", "item_not_in_package"] as const;

type SummaryRow = {
  id: string;
  project_id: string;
  participant_id: string;
  seq: number;
  name: BilingualText;
  status: PackageStatus;
  company_name: BilingualText;
  total: number;
  open: number;
  codes: Record<string, number>;
  /** Whether the viewer is of the owning Participant: only they may change it. */
  owned: boolean;
};

/**
 * The Packages the viewer sees (RLS, app.sees_package), as rows: one Project's, or
 * the one Package `packageId`. Each with its owner's Company name, which every viewer
 * reads (app.package_owner_name), and its counts of the items the viewer sees only
 * (app.package_summary, RP-641). Each read per returned row, never inside the work
 * item query (rp-636: a count there runs for every row).
 */
async function summaryRows(trx: Trx, where: { projectId: string } | { packageId: string }): Promise<SummaryRow[]> {
  const condition = "projectId" in where ? sql`k.project_id = ${where.projectId}::uuid` : sql`k.id = ${where.packageId}::uuid`;
  const { rows } = await sql<SummaryRow>`
    select k.id, k.project_id, k.participant_id, k.seq, k.name, k.status, o.name as company_name,
      coalesce(s.total, 0) as total, coalesce(s.open, 0) as open, coalesce(s.codes, '{}'::jsonb) as codes,
      app.owns_package(k.id) as owned
    from package k
    -- The owning Participant's Company by name only (V14).
    cross join lateral (select app.package_owner_name(k.id) as name) o
    left join lateral app.package_summary(k.id) s on true
    where ${condition}
    order by o.name ->> 'en', k.participant_id, k.seq, k.id
  `.execute(trx);
  return rows;
}

const toSummary = (r: SummaryRow): PackageSummary => ({
  id: r.id,
  projectId: r.project_id,
  number: packageNumber(r.seq),
  name: r.name,
  status: r.status,
  owner: { participantId: r.participant_id, companyName: r.company_name },
  counts: { total: r.total, open: r.open, codes: r.codes },
});

/** A Project's Packages the Member sees; null when it isn't one of their Projects. */
export function listPackages(db: Db, memberId: string, projectId: string): Promise<PackageSummary[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    return (await summaryRows(trx, { projectId })).map(toSummary);
  });
}

/**
 * Package `packageId` as the Member reads it, with only the items they see, each as
 * the List gives it (its "With" and Review Code, RP-641); null when they don't see
 * it. A viewer outside the owning Participant is offered nothing.
 */
export function getPackage(db: Db, memberId: string, packageId: string, now: Date): Promise<PackageDetail | null> {
  return withMember(db, memberId, async (trx) => {
    const [row] = await summaryRows(trx, { packageId });
    if (!row) return null;
    const { rows: ids } = await sql<{ id: string }>`
      select w.id
      from app.package_items(${packageId}::uuid) i
      join work_item w on w.id = i
      order by w.document_number nulls last, w.title, w.id
    `.execute(trx);
    const seen = await workItemRowsById(
      trx,
      { projectId: row.project_id, moduleKey: "submittals" },
      ids.map((i) => i.id),
      now,
    );
    const offers = await bulkOffers(
      trx,
      ids.map((i) => i.id),
    );
    const items = ids.flatMap(({ id }) => {
      const r = seen.get(id);
      return r
        ? [{ id, documentNumber: r.documentNumber, title: r.title, trade: r.trade, with: r.with, outcome: r.outcome, bulkTransitions: offers.get(id) ?? [] }]
        : [];
    });
    const project = await trx.selectFrom("project").select("status").where("id", "=", row.project_id).executeTakeFirst();
    const active = row.owned && project?.status === "active";
    const open = row.status === "open";
    const submit = active && (await submitReadiness(trx, packageId)).ready;
    return {
      ...toSummary(row),
      items,
      actions: { rename: active, addItems: active, removeItems: active && open, delete: active && open, submit },
    };
  });
}

/**
 * The Comments raised from Package `packageId`'s submittals by their Code B (RP-647), for
 * information: only the ones the Member sees, from the items they see (app.package_comments),
 * each as the Snag List gives it, with the submittal it was raised from. Null when they don't
 * see the Package.
 */
export function getPackageComments(db: Db, memberId: string, packageId: string, now: Date): Promise<PackageComments | null> {
  return withMember(db, memberId, async (trx) => {
    const pkg = await trx.selectFrom("package").select("project_id").where("id", "=", packageId).executeTakeFirst();
    if (!pkg) return null;
    const { rows: raised } = await sql<{ work_item_id: string; raised_from_id: string }>`
      select work_item_id, raised_from_id from app.package_comments(${packageId}::uuid)
    `.execute(trx);
    const seen = await workItemRowsById(
      trx,
      { projectId: pkg.project_id, moduleKey: "snag_list" },
      raised.map((r) => r.work_item_id),
      now,
    );
    const sources = new Map((await itemsById(trx, [...new Set(raised.map((r) => r.raised_from_id))])).map((i) => [i.id, i]));
    const comments = raised.flatMap(({ work_item_id, raised_from_id }) => {
      const c = seen.get(work_item_id);
      const source = sources.get(raised_from_id);
      if (!c || !source) return [];
      return [
        {
          id: c.id,
          type: c.type,
          documentNumber: c.documentNumber,
          title: c.title,
          stage: c.stage,
          with: c.with,
          outcome: c.outcome,
          raisedFrom: { id: source.id, documentNumber: source.documentNumber },
        },
      ];
    });
    comments.sort(
      (a, b) =>
        compareText(a.raisedFrom.documentNumber, b.raisedFrom.documentNumber) || compareText(a.documentNumber, b.documentNumber) || compareText(a.id, b.id),
    );
    return { forInformation: true as const, comments };
  });
}

/** Byte by byte, a missing value last. */
const compareText = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/** A Member creates a Package of their Participant on a Project. */
export function createPackage(db: Db, memberId: string, projectId: string, name: BilingualText, now: Date): Promise<CreatePackageResult> {
  return withMember(db, memberId, async (trx): Promise<CreatePackageResult> => {
    const { rows } = await sql<{ outcome: string; package_id: string | null; seq: number | null }>`
      select outcome, package_id, seq from app.create_package(${projectId}::uuid, ${JSON.stringify(name)}::jsonb, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...createRefusals]);
    return outcome === "created" ? { ok: true, id: rows[0]!.package_id!, number: packageNumber(rows[0]!.seq!) } : { ok: false, reason: outcome };
  });
}

/** A Member of the owning Participant renames a Package. */
export function renamePackage(db: Db, memberId: string, packageId: string, name: BilingualText, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.rename_package(${packageId}::uuid, ${JSON.stringify(name)}::jsonb, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "renamed", renameRefusals);
  });
}

/** A Member of the owning Participant deletes (discards) an Open Package; its items stay, without a Package. */
export function discardPackage(db: Db, memberId: string, packageId: string, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`select app.discard_package(${packageId}::uuid, ${now}) as outcome`.execute(trx);
    return commandResult(rows[0]!.outcome, "discarded", discardRefusals);
  });
}

/** A Member of the owning Participant adds one of its submittals to a Package. */
export function addPackageItem(db: Db, memberId: string, packageId: string, workItemId: string, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.add_package_item(${packageId}::uuid, ${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "added", addRefusals);
  });
}

// Submit Package (RP-638) -------------------------------------------------------

/** An item of the Package still to Submit that the viewer sees, with the Submit they may take on it, if any. */
type ToSubmit = { id: string; document_number: string | null; title: string; submit_key: string | null; pick_up: boolean };

/**
 * What Submit Package would take on Package `packageId` for the acting Member: its
 * items they see that aren't Submitted yet (nor closed), each with its Submit
 * Transition they may take now (app.work_item_actions, as the item's own page offers
 * it), and whether an item still to Submit is one they don't see. Ready when there
 * is one to Submit, each has its Submit, and none is hidden.
 */
async function submitReadiness(trx: Trx, packageId: string): Promise<{ items: ToSubmit[]; hidden: boolean; ready: boolean }> {
  const { rows: items } = await sql<ToSubmit>`
    select w.id, w.document_number, w.title,
      (select a.transition_key from app.work_item_actions(w.id) a (action, transition_key, label, transition_kind)
        where a.action = 'transition' and a.transition_kind = 'submit' limit 1) as submit_key,
      exists (select 1 from app.work_item_actions(w.id) a (action, transition_key, label, transition_kind)
        where a.action = 'pick_up') as pick_up
    from app.package_items(${packageId}::uuid) i
    join work_item w on w.id = i
    where w.submitted_at is null and w.closed_at is null
    order by w.document_number nulls last, w.title, w.id
  `.execute(trx);
  const { rows } = await sql<{ hidden: boolean }>`select app.package_hides_unsubmitted(${packageId}::uuid) as hidden`.execute(trx);
  const hidden = rows[0]!.hidden;
  return { items, hidden, ready: !hidden && items.length > 0 && items.every((i) => i.submit_key !== null) };
}

export type SubmitPackageResult =
  | { ok: true; submitted: PackageItem[] }
  | { ok: false; reason: "package_not_ready"; notReady: PackageNotReadyItem[]; othersNotReady: boolean }
  | { ok: false; reason: "not_found" | "project_closed" | "not_confirmed" | "nothing_to_submit" };

/** The command name each item's own key is made under (itemKey). */
const SUBMIT_COMMAND = "submit_package";

const notReadyReason = (reason: string): PackageNotReadyReason =>
  reason === "form_incomplete" || reason === "invalid_action_form" || reason === "validation_failed" ? reason : "refused";

/**
 * Submit Package: a Member of the owning Participant takes, on each item of the
 * Package not yet Submitted, their own Submit Transition, through the same path as a
 * single Submit (takeTransitionIn, app.take_transition), all in one transaction. Each
 * item gets its Document Number, events, notifications and Step Pool routing as a
 * single Submit gives them. All or nothing: when any item isn't ready, nothing is
 * taken and the answer lists the ones the Member sees, with why, and says whether
 * one they don't see stops it too. The same key again applies nothing and answers
 * with the same items.
 */
export async function submitPackage(
  db: Db,
  memberId: string,
  packageId: string,
  input: Required<SubmitPackageRequest>,
  now: Date,
): Promise<SubmitPackageResult> {
  return allOrNothing(db, memberId, async (trx): Promise<SubmitPackageResult> => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${memberId}::uuid::text || '/' || ${input.idempotencyKey}::uuid::text, 0))`.execute(trx);
    // The items still to Submit first, by id, then the Package (app.begin_package_submit locks it):
    // the lock order. An item added meanwhile, after this read, is locked when it is taken.
    const { rows: unsubmitted } = await sql<{ id: string }>`
      select w.id from app.package_items(${packageId}::uuid) i join work_item w on w.id = i
      where w.submitted_at is null and w.closed_at is null
    `.execute(trx);
    await lockWorkItems(
      trx,
      unsubmitted.map((r) => r.id),
    );
    const { rows } = await sql<{ outcome: string; work_item_ids: string[] | null }>`
      select outcome, work_item_ids from app.begin_package_submit(${packageId}::uuid, ${input.idempotencyKey}::uuid)
    `.execute(trx);
    const begun = checkedOutcome(rows[0]!.outcome, ["ready", "replayed", "not_found", "project_closed"]);
    if (begun === "replayed") return { ok: true, submitted: await itemsById(trx, rows[0]!.work_item_ids ?? []) };
    if (begun !== "ready") return { ok: false, reason: begun };
    if (!input.confirmed) return { ok: false, reason: "not_confirmed" };

    const { items, hidden } = await submitReadiness(trx, packageId);
    if (items.length === 0 && !hidden) return { ok: false, reason: "nothing_to_submit" };
    const notReady: PackageNotReadyItem[] = [];
    const item = (i: ToSubmit) => ({ id: i.id, documentNumber: i.document_number, title: i.title });
    for (const i of items) {
      if (i.submit_key === null) notReady.push({ ...item(i), reason: i.pick_up ? "pick_up_first" : "cannot_submit" });
    }
    if (notReady.length > 0 || hidden) return { ok: false, reason: "package_not_ready", notReady, othersNotReady: hidden };

    const takes = items.map((i) => ({
      workItemId: i.id,
      input: { transition: i.submit_key!, answers: {}, internalNote: "", assignTo: null, recommendedCode: null },
    }));
    const refusals = await takeEach(trx, memberId, takes, { command: SUBMIT_COMMAND, key: input.idempotencyKey, now, stopAtFirst: false });
    if (refusals.length > 0) {
      const byId = new Map(items.map((i) => [i.id, i]));
      const listed = refusals.map((r) => ({ ...item(byId.get(r.workItemId)!), reason: notReadyReason(r.refused.reason) }));
      throw new Rollback<SubmitPackageResult>({ ok: false, reason: "package_not_ready", notReady: listed, othersNotReady: false });
    }

    const ids = items.map((i) => i.id);
    const recorded = await sql<{ outcome: string }>`
      select app.record_package_submit(${packageId}::uuid, ${ids}::uuid[], ${input.idempotencyKey}::uuid, ${now}) as outcome
    `.execute(trx);
    checkedOutcome(recorded.rows[0]!.outcome, ["recorded"]);
    return { ok: true, submitted: await itemsById(trx, ids) };
  });
}

/** A Member of the owning Participant removes a submittal from an Open Package. */
export function removePackageItem(db: Db, memberId: string, packageId: string, workItemId: string, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.remove_package_item(${packageId}::uuid, ${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "removed", removeRefusals);
  });
}
