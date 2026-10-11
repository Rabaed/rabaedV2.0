import { readFileSync } from "node:fs";
import { rabaedDefaultWorkflowId, readLatestPublishedDefinition, type Db, type RabaedDefaultResult } from "@rabaed/db";
import { compareStrings, formSchema, parseWorkflowDefinition, sameJson, type WorkflowDefinition } from "@rabaed/domain";
import { sql } from "kysely";
import { publishFormVersion, rabaedDefaultFormId, type PublishFormResult } from "./forms.ts";
import { moveInFlightItems, type InFlightMoved } from "./in-flight.ts";
import { publishRabaedScreen, rabaedScreenDocument, type PublishScreenResult } from "./screens.ts";
import { writeRabaedWorkflow } from "./workflows.ts";

// The Rabaed Defaults as documents (RP-437, WF-14; workflow-engine.md §1 "Rabaed
// Defaults"): the Rabaed Default Screens (apps/admin/screens), Forms (apps/admin/forms)
// and Workflows (apps/admin/workflows), published by one seed step, `pnpm
// defaults:publish`, which the demo seed also runs. Each is published through the
// command its own CLI uses (`form:publish`, `workflow:publish`), after every publish
// check, and only when it differs from the latest published Version: run again, it
// publishes nothing. Screens go first (a Workflow Version pins the Screens it names),
// then Forms (a Workflow's checks read its Type's latest Form), then Workflows. Last,
// the open items still on a Version retired with ADR 0019 move on (in-flight.ts).

/** A Rabaed Default Screen, by its file in apps/admin/screens (its key). */
export const rabaedDefaultScreens = [
  "cover_note",
  "consultant_review",
  "code_a",
  "code_b",
  "code_c",
  "code_d",
  "inspection_passed",
  "inspection_passed_with_comments",
  "inspection_failed",
  "comment_resolution",
] as const;

/**
 * A Rabaed Default Type's Form and Workflow documents, by file. The Shop Drawing (SAR) and
 * Document (DAR) submittals have the MAR's shape and, until their own Forms exist, the
 * MAR's Form (their Types point at its Form definition): so they run the MAR's Workflow
 * document and publish no Form of their own.
 */
export const rabaedDefaultTypes = [
  { type: "MAR", form: "MAR.json", workflow: "MAR.json" },
  { type: "SAR", form: null, workflow: "MAR.json" },
  { type: "DAR", form: null, workflow: "MAR.json" },
  { type: "WIR", form: "WIR.json", workflow: "WIR.json" },
  { type: "CMT", form: "CMT.json", workflow: "CMT.json" },
] as const;

const json = (folder: "screens" | "forms" | "workflows", file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${folder}/${file}`, import.meta.url), "utf8"));

/** Rabaed Default Screen `key`'s document. */
export const rabaedScreenFile = (key: string) => rabaedScreenDocument.parse(json("screens", `${key}.json`));
/** A Rabaed Default Form document (`{"sections": [...]}`). */
export const rabaedFormFile = (file: string): unknown => json("forms", file);
/** A Rabaed Default Workflow definition document. */
export const rabaedWorkflowFile = (file: string): unknown => json("workflows", file);

/** What one document's publish did: published as Version `versionNo`, or already that Version. */
export type DefaultPublished = { kind: "screen" | "form" | "workflow"; name: string; versionNo: number; published: boolean; warnings?: string[] };

export type PublishDefaultsResult =
  | { ok: true; done: DefaultPublished[]; moved: InFlightMoved }
  | { ok: false; kind: "screen"; name: string; result: Exclude<PublishScreenResult, { ok: true }> }
  | { ok: false; kind: "form"; name: string; result: Exclude<PublishFormResult, { ok: true }> }
  | { ok: false; kind: "workflow"; name: string; result: Exclude<RabaedDefaultResult, { ok: true }> };

/**
 * Publishes every Rabaed Default document that differs from its latest published
 * Version, as Rabaed Engineer `engineerId` with `reason` for the Workflows (admin_action,
 * V9), connected as the migrator. Stops at the first refusal, which it returns; what
 * was published before it stays (each publish is its own transaction, as each CLI's).
 */
export async function publishRabaedDefaults(migratorDb: Db, { engineerId, reason }: { engineerId: string; reason: string }): Promise<PublishDefaultsResult> {
  const done: DefaultPublished[] = [];
  for (const key of rabaedDefaultScreens) {
    const result = await publishRabaedScreen(migratorDb, rabaedScreenFile(key));
    if (!result.ok) return { ok: false, kind: "screen", name: key, result };
    done.push({ kind: "screen", name: key, versionNo: result.versionNo, published: result.published });
  }
  for (const { type, form } of rabaedDefaultTypes) {
    if (!form) continue;
    const formId = await rabaedDefaultFormId(migratorDb, type);
    if (!formId) return { ok: false, kind: "form", name: type, result: { ok: false, reason: "form_not_found" } };
    const schema = rabaedFormFile(form);
    const latest = await latestPublishedForm(migratorDb, formId);
    const parsed = formSchema.safeParse(schema);
    if (latest && parsed.success && sameJson(formSchema.parse(latest.schema), parsed.data)) {
      done.push({ kind: "form", name: type, versionNo: latest.version_no, published: false });
      continue;
    }
    const result = await publishFormVersion(migratorDb, formId, schema);
    if (!result.ok) return { ok: false, kind: "form", name: type, result };
    done.push({ kind: "form", name: type, versionNo: result.versionNo, published: true });
  }
  for (const { type, workflow } of rabaedDefaultTypes) {
    const definition = rabaedWorkflowFile(workflow);
    const definitionId = await rabaedDefaultWorkflowId(migratorDb, type);
    const latest = definitionId ? await readLatestPublishedDefinition(migratorDb, definitionId) : null;
    const parsed = parseWorkflowDefinition(definition);
    if (latest && parsed.ok && sameDefinition(latest.definition, parsed.definition) && !(await pinsOlderScreens(migratorDb, definitionId!))) {
      done.push({ kind: "workflow", name: type, versionNo: latest.versionNo, published: false });
      continue;
    }
    const result = await writeRabaedWorkflow(migratorDb, engineerId, type, { definition, reason }, { publish: true });
    if (!result.ok) return { ok: false, kind: "workflow", name: type, result };
    done.push({ kind: "workflow", name: type, versionNo: result.versionNo, published: true, warnings: result.warnings.map((w) => `${w.code}: ${w.message.en}`) });
  }
  return { ok: true, done, moved: await moveInFlightItems(migratorDb) };
}

/**
 * Whether the latest published Version of Workflow `definitionId` pins a Screen Version
 * older than the one its key now means (app.workflow_screens): a Screen published since
 * reaches the Workflow only with its next Version.
 */
async function pinsOlderScreens(db: Db, definitionId: string): Promise<boolean> {
  const { rows } = await sql<{ stale: boolean }>`
    select exists (
      select 1 from workflow_transition t
      join workflow_version v on v.id = t.workflow_version_id
      left join app.workflow_screens(${definitionId}::uuid) s on s.key = t.screen_key
      where v.id = (
          select id from workflow_version
          where workflow_definition_id = ${definitionId}::uuid and status = 'published'
          order by version_no desc limit 1
        )
        and t.screen_key is not null and t.screen_version_id is distinct from s.screen_version_id
    ) as stale
  `.execute(db);
  return rows[0]!.stale;
}

async function latestPublishedForm(db: Db, formId: string) {
  return db
    .selectFrom("form_version")
    .select(["version_no", "schema"])
    .where("form_definition_id", "=", formId)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .executeTakeFirst();
}

/** Whether two definitions are the same Workflow: Steps in any order (rows keep none), Transitions in theirs. */
export function sameDefinition(a: WorkflowDefinition, b: WorkflowDefinition): boolean {
  const steps = (d: WorkflowDefinition) => [...d.steps].sort((x, y) => compareStrings(x.key, y.key));
  return sameJson({ ...a, steps: steps(a) }, { ...b, steps: steps(b) });
}
