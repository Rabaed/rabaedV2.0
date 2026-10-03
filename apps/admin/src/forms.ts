import type { Db } from "@rabaed/db";
import { formSchema, publishProblems, type SchemaProblem } from "@rabaed/domain";
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
    const problems = publishProblems(parsed.data, earlier);
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
