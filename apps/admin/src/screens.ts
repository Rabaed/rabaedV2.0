import type { Db } from "@rabaed/db";
import { bilingualText, formSchema, sameJson, screenKey, screenProblems, type ScreenProblem } from "@rabaed/domain";
import { sql } from "kysely";
import { z } from "zod";

// Rabaed Default Screens (ADR 0019, RP-516; workflow-engine.md §5.7): the reusable Action
// Forms Rabaed Default Workflows name by key, which a Project's Screens with the same key
// replace (app.workflow_screens). Rabaed publishes them as it publishes its Default
// Forms (forms.ts): an operations step with the migrator connection, from the JSON
// documents in apps/admin/screens, run by the `defaults:publish` seed step (RP-437).

/** A Rabaed Default Screen document: its key, its name and the content of its next Version. */
export const rabaedScreenDocument = z.strictObject({
  key: screenKey,
  name: bilingualText,
  schema: z.unknown(),
  internalFields: z.array(z.string().max(64)).max(200),
});
export type RabaedScreenDocument = z.infer<typeof rabaedScreenDocument>;

export type PublishScreenResult =
  /** `published` false: the latest published Version already has this content, so nothing was written. */
  | { ok: true; id: string; versionNo: number; published: boolean }
  | { ok: false; reason: "screen_problems"; problems: ScreenProblem[] };

/**
 * Publishes `document` as the next Version of the Rabaed Default Screen with its key,
 * creating the Screen the first time, after the Screen checks (`screenProblems`). A
 * published Version never changes: Workflow Versions published afterwards pin the new
 * one, and those published before keep theirs. Content equal to the latest published
 * Version publishes nothing, so the seed step can run again. Two publishes of one
 * Screen at once take turns.
 */
export async function publishRabaedScreen(migratorDb: Db, document: RabaedScreenDocument): Promise<PublishScreenResult> {
  return migratorDb.transaction().execute(async (trx): Promise<PublishScreenResult> => {
    const lists = await trx.selectFrom("option_list").select("id").execute();
    const problems = screenProblems(document.schema, document.internalFields, { optionListIds: new Set(lists.map((l) => l.id)) });
    if (problems.length > 0) return { ok: false, reason: "screen_problems", problems };
    const schema = formSchema.parse(document.schema);

    const name = JSON.stringify(document.name);
    const screen = await sql<{ id: string }>`
      insert into screen (owner_kind, key, name) values ('rabaed', ${document.key}, ${name}::jsonb)
      on conflict (key) where owner_kind = 'rabaed' do update set name = excluded.name, updated_at = now()
      returning id
    `.execute(trx);
    // The upsert locks the Screen's row until the transaction ends.
    const screenId = screen.rows[0]!.id;

    const versions = await sql<{ version_no: number; status: string; schema: unknown; internal_fields: string[] }>`
      select version_no, status, schema, internal_fields from screen_version where screen_id = ${screenId}::uuid order by version_no
    `.execute(trx);
    const latest = versions.rows.filter((v) => v.status === "published").at(-1);
    if (
      latest &&
      sameJson(formSchema.parse(latest.schema), schema) &&
      sameJson([...latest.internal_fields].sort(), [...document.internalFields].sort())
    ) {
      return { ok: true, id: screenId, versionNo: latest.version_no, published: false };
    }
    const versionNo = Math.max(0, ...versions.rows.map((v) => v.version_no)) + 1;
    await sql`
      insert into screen_version (screen_id, version_no, status, schema, internal_fields, published_at)
      values (${screenId}::uuid, ${versionNo}, 'published', ${JSON.stringify(schema)}::jsonb, ${document.internalFields}::text[], now())
    `.execute(trx);
    return { ok: true, id: screenId, versionNo, published: true };
  });
}
