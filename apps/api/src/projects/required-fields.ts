import { withMember, type Db } from "@rabaed/db";
import {
  formFields,
  formSchema,
  moduleKeys,
  type BilingualText,
  type ModuleKey,
  type ProjectRequiredFields,
  type RequiredLinkField,
  type SetRequiredFieldRequest,
} from "@rabaed/domain";
import { sql } from "kysely";
import { commandResult } from "../outcomes.ts";
import { isProjectAdmin } from "./project-admin.ts";

// A link question a Project makes required (RP-82; form-engine.md §2.13): Project
// Settings → Required links, such as the WIR's "Approved submittals required". Every
// Project Member reads it, through row-level security (V20); a Project Admin changes
// it through app.set_project_required_field, and anyone else gets 'not_found'. The
// Form engine reads it as `required` on the Project's items of the Type
// (requiredByProject), wherever their answers are checked.

const setRefusals = ["not_found", "project_closed", "type_not_found", "field_not_found"] as const;
export type SetRequiredFieldResult = { ok: true } | { ok: false; reason: (typeof setRefusals)[number] };

/** The keys of the link questions the Project makes required on its items of the Type `typeId`. */
export async function projectRequiredKeys(trx: Db, projectId: string, typeId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("project_required_field")
    .select("field_key")
    .where("project_id", "=", projectId)
    .where("work_item_type_id", "=", typeId)
    .execute();
  return rows.map((r) => r.field_key);
}

type TypeForm = { id: string; code: string; name: BilingualText; module_key: ModuleKey; schema: unknown };

/** Each Work Item Type of the Project (its own of a code, else the Rabaed Default) with the Form a new item of it gets there. */
async function typeForms(trx: Db, projectId: string): Promise<TypeForm[]> {
  const { rows } = await sql<TypeForm & { own: boolean }>`
    select t.id, t.code, t.name, t.module_key, v.schema, t.project_id is not null as own
    from work_item_type t
    join form_version v on v.id = app.new_item_form_version(${projectId}::uuid, t.code)
    where t.project_id is null or t.project_id = ${projectId}::uuid
    order by t.code
  `.execute(trx);
  // The Project's own Type of a code first, as app.project_type_id.
  const byCode = new Map<string, TypeForm & { own: boolean }>();
  for (const t of rows) if (!byCode.has(t.code) || t.own) byCode.set(t.code, t);
  return [...byCode.values()].sort((a, b) => moduleKeys.indexOf(a.module_key) - moduleKeys.indexOf(b.module_key));
}

/** Project Settings → Required links; null when it isn't one of the Member's Projects. */
export function readRequiredFields(db: Db, memberId: string, projectId: string): Promise<ProjectRequiredFields | null> {
  return withMember(db, memberId, async (trx): Promise<ProjectRequiredFields | null> => {
    const onProject = await trx.selectFrom("project").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!onProject) return null;
    const required = await trx.selectFrom("project_required_field").select(["work_item_type_id", "field_key"]).where("project_id", "=", projectId).execute();
    const fields: RequiredLinkField[] = (await typeForms(trx, projectId)).flatMap((t) =>
      formFields(formSchema.parse(t.schema)).flatMap((f) =>
        f.type === "work_item_ref"
          ? [
              {
                type: t.code,
                typeName: t.name,
                key: f.key,
                label: f.label,
                requiredByForm: f.required === true,
                required: required.some((r) => r.work_item_type_id === t.id && r.field_key === f.key),
              },
            ]
          : [],
      ),
    );
    return { canEdit: await isProjectAdmin(trx, projectId), fields };
  });
}

/**
 * A Project Admin makes a Type's link question required on the Project, or not. The
 * key must be a link question of the Form a new item of the Type gets there; anyone
 * but a Project Admin is told 'not_found' before that, so it names nothing.
 */
export function setRequiredField(db: Db, memberId: string, projectId: string, input: SetRequiredFieldRequest, now: Date): Promise<SetRequiredFieldResult> {
  return withMember(db, memberId, async (trx): Promise<SetRequiredFieldResult> => {
    if (!(await isProjectAdmin(trx, projectId))) return { ok: false, reason: "not_found" };
    // A Type with no Form on the Project has no link question either.
    const form = (await typeForms(trx, projectId)).find((t) => t.code === input.type);
    if (!form) return { ok: false, reason: "type_not_found" };
    if (!formFields(formSchema.parse(form.schema)).some((f) => f.type === "work_item_ref" && f.key === input.key)) {
      return { ok: false, reason: "field_not_found" };
    }
    const { rows } = await sql<{ outcome: string }>`
      select app.set_project_required_field(${projectId}::uuid, ${input.type}, ${input.key}, ${input.required}, ${now}) as outcome
    `.execute(trx);
    return commandResult(rows[0]!.outcome, "set", setRefusals);
  });
}
