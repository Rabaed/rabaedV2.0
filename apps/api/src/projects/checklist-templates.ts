import { withMember, type Database, type Db } from "@rabaed/db";
import {
  checklistCopy,
  checklistTemplateItems,
  type ChecklistCopy,
  type ChecklistTemplate,
  type ChecklistTemplateRequest,
  type ChecklistTemplates,
} from "@rabaed/domain";
import { sql, type Transaction } from "kysely";
import { checkedOutcome, commandResult } from "../outcomes.ts";
import { isProjectAdmin } from "./project-admin.ts";

// A Project's Checklist Templates (RP-651; form-engine.md §3.2): Project Settings →
// Checklist Templates. Every Project Member of every Participant reads them, through
// row-level security and the tables' column grants, so never who wrote one or when
// (V20); a Project Admin creates, edits (a new Version each time) and retires them
// through the app.* functions of the checklist_templates migration, and anyone else
// gets 'not_found'. A Work Item's `checklist_template` field picks one; its copy on the
// item is `work_item_checklist` (itemChecklistCopies).

type Trx = Transaction<Database>;

const createRefusals = ["not_found", "project_closed", "trade_not_found"] as const;
export type CreateChecklistTemplateResult = { ok: true; id: string } | { ok: false; reason: (typeof createRefusals)[number] };

const editRefusals = ["not_found", "project_closed", "template_retired", "trade_not_found"] as const;
export type EditChecklistTemplateResult = { ok: true } | { ok: false; reason: (typeof editRefusals)[number] };

const retireRefusals = ["not_found", "project_closed"] as const;
export type RetireChecklistTemplateResult = { ok: true } | { ok: false; reason: (typeof retireRefusals)[number] };

/** The Project's Checklist Templates as they read now (their latest Versions), by Trade as the Trades are listed, then by English name. */
export async function projectChecklistTemplates(trx: Trx, projectId: string): Promise<ChecklistTemplate[]> {
  const { rows } = await sql<{
    id: string;
    version_id: string;
    version_no: number;
    name: ChecklistTemplate["name"];
    trade_value_id: string;
    status: ChecklistTemplate["status"];
    items: unknown;
  }>`
    select t.id, v.id as version_id, v.version_no, v.name, v.trade_value_id, t.status, v.items
    from checklist_template t
    join checklist_template_version v on v.checklist_template_id = t.id and v.version_no = t.version_no
    join dimension_value tv on tv.id = v.trade_value_id
    where t.project_id = ${projectId}::uuid
    order by tv.sort, tv.id, lower(v.name ->> 'en'), t.id
  `.execute(trx);
  return rows.map((r) => ({
    id: r.id,
    versionId: r.version_id,
    versionNo: r.version_no,
    name: r.name,
    tradeId: r.trade_value_id,
    status: r.status,
    items: checklistTemplateItems.parse(r.items),
  }));
}

/** The Checklist Template Versions copied onto a visible item, by field; none for an item the Member can't see (RLS). */
export async function itemChecklistCopies(trx: Trx, workItemId: string): Promise<ChecklistCopy[]> {
  const { rows } = await sql<{
    field_key: string;
    checklist_template_id: string;
    version_id: string;
    version_no: number;
    name: ChecklistCopy["name"];
    trade_value_id: string;
    items: unknown;
  }>`
    select c.field_key, v.checklist_template_id, c.checklist_template_version_id as version_id, v.version_no, c.name, v.trade_value_id, c.items
    from work_item_checklist c
    join checklist_template_version v on v.id = c.checklist_template_version_id
    where c.work_item_id = ${workItemId}::uuid
    order by c.field_key
  `.execute(trx);
  return rows.map((r) =>
    checklistCopy.parse({
      fieldKey: r.field_key,
      templateId: r.checklist_template_id,
      versionId: r.version_id,
      versionNo: r.version_no,
      name: r.name,
      tradeId: r.trade_value_id,
      items: r.items,
    }),
  );
}

/** Project Settings → Checklist Templates; null when it isn't one of the Member's Projects. */
export function listChecklistTemplates(db: Db, memberId: string, projectId: string): Promise<ChecklistTemplates | null> {
  return withMember(db, memberId, async (trx) => {
    const project = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    return { canEdit: await isProjectAdmin(trx, projectId), templates: await projectChecklistTemplates(trx, projectId) };
  });
}

/** A Project Admin creates a Checklist Template on their Project, as its Version 1. */
export function createChecklistTemplate(
  db: Db,
  memberId: string,
  projectId: string,
  input: ChecklistTemplateRequest,
  now: Date,
): Promise<CreateChecklistTemplateResult> {
  return withMember(db, memberId, async (trx): Promise<CreateChecklistTemplateResult> => {
    const { rows } = await sql<{ outcome: string; template_id: string | null }>`
      select outcome, template_id from app.create_checklist_template(
        ${projectId}::uuid, ${JSON.stringify(input.name)}::jsonb, ${input.tradeId}::uuid, ${JSON.stringify(input.items)}::jsonb, ${now})
    `.execute(trx);
    const outcome = checkedOutcome(rows[0]!.outcome, ["created", ...createRefusals]);
    return outcome === "created" ? { ok: true, id: rows[0]!.template_id! } : { ok: false, reason: outcome };
  });
}

/** A Project Admin edits a Checklist Template into its next Version: the items that copied an earlier one keep it. */
export function editChecklistTemplate(
  db: Db,
  memberId: string,
  templateId: string,
  input: ChecklistTemplateRequest,
  now: Date,
): Promise<EditChecklistTemplateResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select outcome from app.edit_checklist_template(
        ${templateId}::uuid, ${JSON.stringify(input.name)}::jsonb, ${input.tradeId}::uuid, ${JSON.stringify(input.items)}::jsonb, ${now})
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "edited", editRefusals);
  });
}

/** A Project Admin retires a Checklist Template: offered to no new pick, kept on the items that copied it. */
export function retireChecklistTemplate(db: Db, memberId: string, templateId: string, now: Date): Promise<RetireChecklistTemplateResult> {
  return withMember(db, memberId, async (trx) => {
    const { rows } = await sql<{ outcome: string }>`
      select app.retire_checklist_template(${templateId}::uuid, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "retired", retireRefusals);
  });
}
