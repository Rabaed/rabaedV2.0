import type { Db } from "@rabaed/db";
import { formSchema, publishProblems, type SchemaProblem, type WorkflowStepHolder } from "@rabaed/domain";
import { sql } from "kysely";

export type PublishFormResult =
  | { ok: true; id: string; versionNo: number }
  | { ok: false; reason: "form_not_found" }
  /** Not a Form schema at all (form-engine.md §1): `issues` says where. */
  | { ok: false; reason: "invalid_schema"; issues: string[] }
  /** A schema, but the publish-time checks refuse it (form-engine.md §7). */
  | { ok: false; reason: "schema_problems"; problems: SchemaProblem[] };

/**
 * Publishes `schema` as the next Version of the Form `formDefinitionId`, frozen
 * from then on (form-engine.md §7; RP-271). The publish-time checks run first,
 * against every Version published before, so a broken schema never reaches a
 * Project. New Work Items then pin it; items on earlier Versions keep theirs.
 *
 * An operations step, as Rabaed publishes its Default Forms in this part (no
 * builder yet): run with the migrator connection by the `form:publish` script.
 * Two publishes of one Form at once take turns.
 */
export async function publishFormVersion(migratorDb: Db, formDefinitionId: string, schema: unknown): Promise<PublishFormResult> {
  const parsed = formSchema.safeParse(schema);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_schema", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(schema)"}: ${i.message}`) };
  }
  return migratorDb.transaction().execute(async (trx): Promise<PublishFormResult> => {
    const definition = await trx
      .selectFrom("form_definition")
      .select("id")
      .where("id", "=", formDefinitionId)
      .forUpdate()
      .executeTakeFirst();
    if (!definition) return { ok: false, reason: "form_not_found" };

    const versions = await trx
      .selectFrom("form_version")
      .select(["version_no", "status", "schema"])
      .where("form_definition_id", "=", formDefinitionId)
      .orderBy("version_no")
      .execute();
    const earlier = versions.filter((v) => v.status === "published").map((v) => formSchema.parse(v.schema));
    const lists = await trx.selectFrom("option_list").select("id").execute();
    const problems = publishProblems(parsed.data, earlier, {
      optionListIds: new Set(lists.map((l) => l.id)),
      workflows: await typeWorkflows(trx, formDefinitionId),
    });
    if (problems.length > 0) return { ok: false, reason: "schema_problems", problems };

    const versionNo = Math.max(0, ...versions.map((v) => v.version_no)) + 1;
    const published = await trx
      .insertInto("form_version")
      .values({
        form_definition_id: formDefinitionId,
        version_no: versionNo,
        status: "published",
        published_at: sql<Date>`now()`,
        schema: JSON.stringify(parsed.data),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { ok: true, id: published.id, versionNo };
  });
}

/**
 * The Workflows of the Work Item Types that use the Form, each as the Steps of
 * its latest published Version (the one new items start on), which `editable_at`
 * is checked against (form-engine.md §4).
 */
async function typeWorkflows(db: Db, formDefinitionId: string): Promise<WorkflowStepHolder[][]> {
  const { rows } = await sql<{ type_id: string; key: string; role: string | null; draft: boolean }>`
    select t.id as type_id, s.key, s.actor_rule ->> 'base_role' as role, app.is_draft_step(s.id) as draft
    from work_item_type t
    join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.status = 'published'
      and v.version_no = (
        select max(o.version_no) from workflow_version o where o.workflow_definition_id = t.workflow_definition_id and o.status = 'published'
      )
    join workflow_step s on s.workflow_version_id = v.id
    where t.form_definition_id = ${formDefinitionId}
    order by t.id, s.key
  `.execute(db);
  const byType = new Map<string, WorkflowStepHolder[]>();
  for (const { type_id, key, role, draft } of rows) byType.set(type_id, [...(byType.get(type_id) ?? []), { key, role, draft }]);
  return [...byType.values()];
}

/** The Form of the Rabaed Default Work Item Type `typeCode`, if it has one. */
export async function rabaedDefaultFormId(db: Db, typeCode: string): Promise<string | null> {
  const type = await db
    .selectFrom("work_item_type")
    .select("form_definition_id")
    .where("owner_kind", "=", "rabaed")
    .where("code", "=", typeCode)
    .executeTakeFirst();
  return type?.form_definition_id ?? null;
}
