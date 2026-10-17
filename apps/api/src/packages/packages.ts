import { withMember, type Db } from "@rabaed/db";
import { packageNumber, type BilingualText, type PackageDetail, type PackageStatus, type PackageSummary } from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import type { Database } from "@rabaed/db";
import { checkedOutcome, commandResult } from "../outcomes.ts";

// Packages (spec RP-616; RP-636 an Open Package). Reads go through the package
// table's row-level security (app.sees_package) and column grants; a Package's
// items through app.package_items, which gives only the items the viewer sees, so
// a list or count never includes one they don't. Writes go through the app.*
// functions of the open_package migration, each re-checking the caller's access:
// a Package they don't see is 'not_found', exactly like a made-up id.
//
// Later tickets extend this module: Submit Package (RP-638) adds a command and an
// action; the board's counts (RP-641) come from app.package_summary into
// PackageSummary; bulk Transitions (RP-646) and the packageId filter (RP-647) read
// the items the same way.

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
};

/** The Packages the viewer sees, as rows: one Project's, or the one Package `packageId`. */
async function summaryRows(trx: Trx, where: { projectId: string } | { packageId: string }): Promise<SummaryRow[]> {
  const condition = "projectId" in where ? sql`k.project_id = ${where.projectId}::uuid` : sql`k.id = ${where.packageId}::uuid`;
  const { rows } = await sql<SummaryRow>`
    select k.id, k.project_id, k.participant_id, k.seq, k.name, k.status, pp.legal_name as company_name
    from package k
    -- The owning Participant's Company by name only (V14).
    left join lateral (
      select x.legal_name from app.project_participants(k.project_id) x where x.participant_id = k.participant_id
    ) pp on true
    where ${condition}
    order by pp.legal_name ->> 'en', k.participant_id, k.seq, k.id
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
});

/** A Project's Packages the Member sees; null when it isn't one of their Projects. */
export function listPackages(db: Db, memberId: string, projectId: string): Promise<PackageSummary[] | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    return (await summaryRows(trx, { projectId })).map(toSummary);
  });
}

/** Package `packageId` as the Member reads it, with only the items they see; null when they don't see it. */
export function getPackage(db: Db, memberId: string, packageId: string): Promise<PackageDetail | null> {
  return withMember(db, memberId, async (trx) => {
    const [row] = await summaryRows(trx, { packageId });
    if (!row) return null;
    const { rows: items } = await sql<{ id: string; document_number: string | null; title: string }>`
      select w.id, w.document_number, w.title
      from app.package_items(${packageId}::uuid) i
      join work_item w on w.id = i
      order by w.document_number nulls last, w.title, w.id
    `.execute(trx);
    const project = await trx.selectFrom("project").select("status").where("id", "=", row.project_id).executeTakeFirst();
    const active = project?.status === "active";
    const open = row.status === "open";
    return {
      ...toSummary(row),
      items: items.map((i) => ({ id: i.id, documentNumber: i.document_number, title: i.title })),
      actions: { rename: active, addItems: active, removeItems: active && open, delete: active && open },
    };
  });
}

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

/** A Member of the owning Participant removes a submittal from an Open Package. */
export function removePackageItem(db: Db, memberId: string, packageId: string, workItemId: string, now: Date) {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.remove_package_item(${packageId}::uuid, ${workItemId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "removed", removeRefusals);
  });
}
