import {
  confirmRegisterImport,
  getRegisterImport,
  getRegisterImportFields,
  previewRegisterImport,
  readRegister,
  registerImportValues,
  type ConfirmRegisterImportResult,
  type ImportingEngineer,
  type PreviewRegisterImportResult,
  type ReadRegisterResult,
  type RegisterImporter,
  type RegisterImportValuesResult,
} from "@rabaed/api/register-import";
import { APP_ROLE, type AdminActionTable, type Database, type Db } from "@rabaed/db";
import type {
  AdminPreviewRegisterImportRequest,
  AdminReadRegisterRequest,
  AdminRegisterImportFor,
  AdminRegisterImportParticipants,
  AdminRegisterImportProjects,
  BilingualText,
  RegisterImport,
  RegisterImportFields,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { asEngineer } from "./admin-action.ts";
import { Refused, refusable } from "./refusals.ts";

// The Submittal Register Import by a Rabaed Engineer (RP-645, spec RP-631 stories 38–41;
// visibility.md RP-589-3). The Engineer picks a Project, a Participant and a default Member
// of it, gives a reason, and runs the api's own import (no second copy of its reading,
// matching or checks) as that default Member, who stands where a Member's importer stands:
// they raise every row nobody else is assigned. The import is the Engineer's, which the
// Company reads as "Rabaed". Every step is an admin_action with the reason (V9); a step
// refused before it runs (no such Participant, a default Member who isn't theirs) rolls back
// and logs nothing. No time of an import is read here either: the admin_action keeps its
// own `at`, for Rabaed's audit only.

type Trx = Transaction<Database>;

/** Why an Engineer's import step isn't run: no such Project or Participant; the default Member isn't an active Member of it; or they may raise no Submittals Type there. */
export type ImportForRefusal = { ok: false; reason: "not_found" | "default_member_not_found" | "forbidden" };
type ForReason = ImportForRefusal["reason"];

/** Acts as `memberId` for the rest of the admin_action's transaction (the api's import code reads it). */
const actAs = (trx: Trx, memberId: string) => sql`select set_config('app.member_id', ${memberId}, true)`.execute(trx);

// RP-960: the api's import steps run as the app role, held to row-level security as the
// Member acted as, so a read the explicit scoping misses fails closed. rabaed_admin is a
// member of rabaed_app without inheritance (packages/db/src/bootstrap.ts): switched, it has
// the app role's privileges and none of its own, bypassrls included. These two are the only
// switches, both transaction-local.
/** The rest of the transaction as the app role. */
const asApp = (trx: Trx) => sql`set local role ${sql.id(APP_ROLE)}`.execute(trx);
/** The rest of the transaction as Rabaed Admin's own role again (the session's). */
const asAdmin = (trx: Trx) => sql`set local role none`.execute(trx);

/**
 * The Engineer's side of a step (ImportingEngineer): what is theirs alone (their
 * `_by_engineer` functions, their own import's header and rows) on Rabaed Admin's role,
 * back to the app role after.
 */
const importingEngineer = (id: string): ImportingEngineer => ({
  id,
  own: async (trx, fn) => {
    await asAdmin(trx);
    const result = await fn(trx);
    await asApp(trx);
    return result;
  },
});

/** Refuses an import for a Participant the default Member isn't an active Member of, or one who may not import there (app.register_import_raisers, the shared rule). */
async function checkFor(trx: Trx, imported: AdminRegisterImportFor): Promise<void> {
  const { rows } = await sql<{ member_id: string; may_import: boolean }>`
    select member_id, may_import from app.register_import_raisers(${imported.projectId}::uuid)
    where participant_id = ${imported.participantId}::uuid
  `.execute(trx);
  if (rows.length === 0) throw new Refused<ForReason>("not_found");
  const member = rows.find((r) => r.member_id === imported.defaultMemberId);
  if (!member) throw new Refused<ForReason>("default_member_not_found");
  if (!member.may_import) throw new Refused<ForReason>("forbidden");
}

/**
 * One step of an Engineer's import: one admin_action, `action` with the reason, run as the
 * Member `actingAs` names (none: nobody is acted as, so the api's step finds nothing), and
 * logged with the target and `after` that `log` says of its result. `actingAs` and the log
 * run on Rabaed Admin's role; the api's step as the app role, but for what it hands to `engineer.own`.
 */
function engineerStep<R>(
  adminDb: Db,
  context: { engineerId: string; action: AdminActionTable["action"]; reason: string },
  actingAs: (trx: Trx) => Promise<string | null>,
  log: (result: R) => { target: { kind: string; id: string | null }; after?: unknown },
): RegisterImporter<R>["run"] {
  return (fn) =>
    asEngineer(adminDb, context, async (trx) => {
      const member = await actingAs(trx);
      if (member) await actAs(trx, member);
      await asApp(trx);
      const result = await fn(trx);
      await asAdmin(trx);
      return { ...log(result), result };
    });
}

/**
 * The Engineer importing for a Participant as its default Member: each step one
 * admin_action, `action` with the reason, whose target the step's result names.
 */
function engineerImporter<R>(
  adminDb: Db,
  engineerId: string,
  imported: AdminRegisterImportFor,
  action: AdminActionTable["action"],
  targetOf: (result: R) => { kind: string; id: string | null } = () => ({ kind: "project", id: imported.projectId }),
  after: (result: R) => Record<string, unknown> = () => ({}),
): RegisterImporter<R> & { engineer: ImportingEngineer & { participantId: string } } {
  return {
    engineer: { ...importingEngineer(engineerId), participantId: imported.participantId },
    run: engineerStep<R>(
      adminDb,
      { engineerId, action, reason: imported.reason },
      async (trx) => {
        await checkFor(trx, imported);
        return imported.defaultMemberId;
      },
      // Whom it was for, never a time.
      (result) => ({ target: targetOf(result), after: { participantId: imported.participantId, defaultMemberId: imported.defaultMemberId, ...after(result) } }),
    ),
  };
}

/** A step's result, or the refusal its check threw (rolled back, nothing logged). */
async function checked<T>(step: () => Promise<T>): Promise<T | ImportForRefusal> {
  const result = await refusable<T, ForReason>(step);
  return result.ok ? result.value : { ok: false, reason: result.reason };
}

/** The active Projects, by name: where an Engineer may import (the Company & reason step). Logged as a read. */
export function listImportProjects(adminDb: Db, engineerId: string, reason: string): Promise<AdminRegisterImportProjects> {
  return asEngineer(adminDb, { engineerId, action: "read_register_import", reason }, async (trx) => {
    const projects = await trx
      .selectFrom("project")
      .select(["id", "name", "code"])
      .where("status", "=", "active")
      .orderBy(sql`name ->> 'en'`)
      .orderBy("id")
      .execute();
    return {
      target: { kind: "project", id: null },
      result: { projects: projects.map((p) => ({ id: p.id, name: p.name as BilingualText, code: p.code })) },
    };
  });
}

/**
 * A Project's active Participants and their active Members, each with whether they may
 * import (the Company & reason step); null for no such Project. Logged as a read.
 */
export function listImportParticipants(adminDb: Db, engineerId: string, projectId: string, reason: string): Promise<AdminRegisterImportParticipants | null> {
  return asEngineer(adminDb, { engineerId, action: "read_register_import", reason }, async (trx) => {
    const target = { kind: "project", id: projectId };
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { target, result: null };
    const { rows: participants } = await sql<{ id: string; company_name: BilingualText; role_name: BilingualText }>`
      select p.id, c.legal_name as company_name, r.name as role_name
      from participant p join company c on c.id = p.company_id join project_role r on r.id = p.project_role_id
      where p.project_id = ${projectId}::uuid and p.status = 'active'
      order by p.ordinal nulls last, c.legal_name ->> 'en', p.id
    `.execute(trx);
    const { rows: members } = await sql<{ participant_id: string; id: string; name: BilingualText; email: string; may_import: boolean }>`
      select x.participant_id, m.id, m.full_name as name, m.email, x.may_import
      from app.register_import_raisers(${projectId}::uuid) x join member m on m.id = x.member_id
      order by m.full_name ->> 'en', m.email
    `.execute(trx);
    return {
      target,
      result: {
        participants: participants.map((p) => {
          const own = members.filter((m) => m.participant_id === p.id);
          return {
            id: p.id,
            companyName: p.company_name,
            roleName: p.role_name,
            mayImport: own.some((m) => m.may_import),
            members: own.map((m) => ({ id: m.id, name: m.name, email: m.email, mayImport: m.may_import })),
          };
        }),
      },
    };
  });
}

/** Reads an uploaded register for the Engineer's import, as the default Member would (the api's readRegister). */
export function readRegisterFor(adminDb: Db, engineerId: string, request: AdminReadRegisterRequest): Promise<ReadRegisterResult | ImportForRefusal> {
  const { for: imported, ...read } = request;
  return checked(() => readRegister(engineerImporter(adminDb, engineerId, imported, "read_register_import"), imported.projectId, read));
}

/** What a register may fill on the Project, as the default Member may fill it (the api's getRegisterImportFields). */
export function registerImportFieldsFor(
  adminDb: Db,
  engineerId: string,
  imported: AdminRegisterImportFor,
): Promise<RegisterImportFields | ImportForRefusal | { ok: false; reason: "not_found" | "forbidden" }> {
  return checked(() => getRegisterImportFields(engineerImporter(adminDb, engineerId, imported, "read_register_import"), imported.projectId));
}

/** Map values for the Engineer's import (the api's registerImportValues). */
export function registerImportValuesFor(adminDb: Db, engineerId: string, request: AdminPreviewRegisterImportRequest): Promise<RegisterImportValuesResult | ImportForRefusal> {
  const { for: imported, ...preview } = request;
  return checked(() => registerImportValues(engineerImporter(adminDb, engineerId, imported, "read_register_import"), imported.projectId, preview));
}

/**
 * Previews the register as the Engineer's import for the Participant, with its default
 * Member as the importer (the api's previewRegisterImport): every check a Member's import gets.
 */
export function previewRegisterImportFor(
  adminDb: Db,
  engineerId: string,
  request: AdminPreviewRegisterImportRequest,
  now: Date,
): Promise<PreviewRegisterImportResult | ImportForRefusal> {
  const { for: imported, ...preview } = request;
  const importer = engineerImporter<PreviewRegisterImportResult>(
    adminDb,
    engineerId,
    imported,
    "preview_register_import",
    (result) => (result.ok ? { kind: "submittal_register_import", id: result.id } : { kind: "project", id: imported.projectId }),
    // The original register handed over to the api with the preview, which stores it (RP-959).
    (result) => (result.ok ? { outcome: "previewed", original: result.original } : { outcome: result.reason }),
  );
  return checked(() => previewRegisterImport(importer, imported.projectId, preview, now));
}

/**
 * The Engineer's own import, read or confirmed as its default Member: whom it is for comes
 * from the import itself. Another Engineer's import, a Member's, or none reads as none.
 */
function ownImporter<R>(
  adminDb: Db,
  engineerId: string,
  importId: string,
  reason: string,
  action: AdminActionTable["action"],
  after?: (result: R) => unknown,
): RegisterImporter<R> {
  return {
    engineer: importingEngineer(engineerId),
    run: engineerStep<R>(
      adminDb,
      { engineerId, action, reason },
      async (trx) => {
        const { rows } = await sql<{ default_member_id: string }>`
          select default_member_id from submittal_register_import where id = ${importId}::uuid and run_by_engineer_id = ${engineerId}::uuid
        `.execute(trx);
        // Not theirs: nobody is acted as, so the api's steps find nothing.
        return rows[0]?.default_member_id ?? null;
      },
      (result) => ({ target: { kind: "submittal_register_import", id: importId }, after: after?.(result) }),
    ),
  };
}

/** The Engineer's own import with its rows (the api's getRegisterImport); null when it isn't theirs. Logged as a read. */
export function getRegisterImportFor(adminDb: Db, engineerId: string, importId: string, reason: string): Promise<RegisterImport | null> {
  return getRegisterImport(ownImporter(adminDb, engineerId, importId, reason, "read_register_import"), importId);
}

/** Creates the Drafts of the Engineer's own preview, raised by its default Member or each row's assignee (the api's confirmRegisterImport). */
export function confirmRegisterImportFor(adminDb: Db, engineerId: string, importId: string, reason: string, now: Date): Promise<ConfirmRegisterImportResult> {
  const importer = ownImporter<ConfirmRegisterImportResult>(adminDb, engineerId, importId, reason, "confirm_register_import", (result) =>
    result.ok ? { rowsCreated: result.rowsCreated } : { outcome: result.reason },
  );
  return confirmRegisterImport(importer, importId, now);
}
