import { readFileSync } from "node:fs";
import { readLatestPublishedDefinition, type Db, type RabaedDefaultResult } from "@rabaed/db";
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
  "inspection_code_a",
  "inspection_code_b",
  "inspection_code_c",
  "inspection_code_d",
  "inspection_passed",
  "inspection_passed_with_comments",
  "inspection_failed",
  "comment_resolution",
  "snag_resolution",
  "question_answer",
] as const;

/**
 * The eight Rabaed Default submittal Workflows (RP-596, ADR 0022): the number of reviewers on
 * each side, 1 (the PM alone) or 2 (Engineer, then PM), each with and without the Owner's
 * final review. `key` is the `default_key` of the Rabaed Default it is published into, one per
 * submittal Type; the name is the Workflow's, in both languages, Latin digits in both.
 */
export const submittalWorkflows = [
  {
    key: "1-1",
    file: "submittal-1-1.json",
    name: { en: "1→1 Contractor PM → Consultant PM", ar: "1→1 مدير المقاول ← مدير الاستشاري" },
  },
  {
    key: "1-2",
    file: "submittal-1-2.json",
    name: { en: "1→2 Contractor PM → Consultant Engineer → Consultant PM", ar: "1→2 مدير المقاول ← مهندس الاستشاري ← مدير الاستشاري" },
  },
  {
    key: "2-1",
    file: "submittal-2-1.json",
    name: { en: "2→1 Contractor Engineer → Contractor PM → Consultant PM", ar: "2→1 مهندس المقاول ← مدير المقاول ← مدير الاستشاري" },
  },
  {
    key: "2-2",
    file: "submittal-2-2.json",
    name: {
      en: "2→2 Contractor Engineer → Contractor PM → Consultant Engineer → Consultant PM",
      ar: "2→2 مهندس المقاول ← مدير المقاول ← مهندس الاستشاري ← مدير الاستشاري",
    },
  },
  {
    key: "1-1-owner",
    file: "submittal-1-1-owner.json",
    name: { en: "1→1 Contractor PM → Consultant PM → Owner review", ar: "1→1 مدير المقاول ← مدير الاستشاري ← مراجعة المالك" },
  },
  {
    key: "1-2-owner",
    file: "submittal-1-2-owner.json",
    name: {
      en: "1→2 Contractor PM → Consultant Engineer → Consultant PM → Owner review",
      ar: "1→2 مدير المقاول ← مهندس الاستشاري ← مدير الاستشاري ← مراجعة المالك",
    },
  },
  {
    key: "2-1-owner",
    file: "submittal-2-1-owner.json",
    name: {
      en: "2→1 Contractor Engineer → Contractor PM → Consultant PM → Owner review",
      ar: "2→1 مهندس المقاول ← مدير المقاول ← مدير الاستشاري ← مراجعة المالك",
    },
  },
  {
    key: "2-2-owner",
    file: "submittal-2-2-owner.json",
    name: {
      en: "2→2 Contractor Engineer → Contractor PM → Consultant Engineer → Consultant PM → Owner review",
      ar: "2→2 مهندس المقاول ← مدير المقاول ← مهندس الاستشاري ← مدير الاستشاري ← مراجعة المالك",
    },
  },
] as const;

/**
 * A Rabaed Default Type's Form and Workflow documents, by file. A Type whose `form` is null
 * publishes no Form. `workflow` is the document of the Workflow the Type runs while a Project
 * binds none (the Type's own `workflow_definition_id`): the MAR and the SAR run 2→2, the DAR
 * 1→1 → Owner review (RP-596). The three submittals also have each of the eight (`variants`),
 * published as Rabaed Defaults of their own that a Project Admin may bind or duplicate; `workflow`
 * is one of them. `history` lists the documents of the Type's earlier Workflow Versions, Version 1
 * first, that still have items on them (RP-170: the WIR's Version 1, `WIR-1.json`; RP-673: its
 * Version 2, `WIR-2.json`, whose items finish with an Inspection Result; RP-86: its Version 3,
 * `WIR-3.json`, whose codes hold no checklist): each is published as its
 * Version only while the Type's Workflow has no Version that number or later, so a database seeded
 * before a later document keeps its own earlier Versions and a fresh one gets the same Versions.
 */
export const rabaedDefaultTypes = [
  { type: "MAR", form: "MAR.json", workflow: "submittal-2-2.json", variants: submittalWorkflows, history: null },
  { type: "SAR", form: "SAR.json", workflow: "submittal-2-2.json", variants: submittalWorkflows, history: null },
  { type: "DAR", form: "DAR.json", workflow: "submittal-1-1-owner.json", variants: submittalWorkflows, history: null },
  { type: "WIR", form: "WIR.json", workflow: "WIR.json", variants: null, history: ["WIR-1.json", "WIR-2.json", "WIR-3.json"] },
  { type: "CMT", form: "CMT.json", workflow: "CMT.json", variants: null, history: null },
  { type: "SNG", form: "SNG.json", workflow: "SNG.json", variants: null, history: null },
  { type: "QSN", form: "QST.json", workflow: "QSN.json", variants: null, history: null },
  { type: "QSC", form: "QST.json", workflow: "QSC.json", variants: null, history: null },
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
  for (const entry of rabaedDefaultTypes) {
    const { type, workflow } = entry;
    // The Type's earlier Versions (RP-170), before the Workflow it runs publishes the next.
    for (const [index, file] of (entry.history ?? []).entries()) {
      const [versionNo, name] = [index + 1, `${type}@${index + 1}`];
      const definitionId = await ensureRabaedWorkflow(migratorDb, type, null, true);
      if (!definitionId) continue;
      const latest = await readLatestPublishedDefinition(migratorDb, definitionId);
      if (latest && latest.versionNo >= versionNo) continue;
      const result = await writeRabaedWorkflow(migratorDb, engineerId, type, { definition: rabaedWorkflowFile(file), reason }, { publish: true, workflowId: definitionId });
      if (!result.ok) return { ok: false, kind: "workflow", name, result };
      done.push({ kind: "workflow", name, versionNo: result.versionNo, published: true, warnings: result.warnings.map((w) => `${w.code}: ${w.message.en}`) });
    }
    // The Workflow the Type runs, then the Type's other Rabaed Defaults (RP-596).
    const targets: { name: string; file: string; variant: SubmittalWorkflow | null }[] = [
      { name: type, file: workflow, variant: entry.variants?.find((v) => v.file === workflow) ?? null },
      ...(entry.variants ?? []).filter((v) => v.file !== workflow).map((v) => ({ name: `${type}:${v.key}`, file: v.file, variant: v })),
    ];
    for (const { name, file, variant } of targets) {
      const definition = rabaedWorkflowFile(file);
      const definitionId = await ensureRabaedWorkflow(migratorDb, type, variant, file === workflow);
      const latest = definitionId ? await readLatestPublishedDefinition(migratorDb, definitionId) : null;
      const parsed = parseWorkflowDefinition(definition);
      if (latest && parsed.ok && sameDefinition(latest.definition, parsed.definition) && !(await pinsOlderScreens(migratorDb, definitionId!))) {
        done.push({ kind: "workflow", name, versionNo: latest.versionNo, published: false });
        continue;
      }
      const result = await writeRabaedWorkflow(migratorDb, engineerId, type, { definition, reason }, { publish: true, workflowId: definitionId });
      if (!result.ok) return { ok: false, kind: "workflow", name, result };
      done.push({ kind: "workflow", name, versionNo: result.versionNo, published: true, warnings: result.warnings.map((w) => `${w.code}: ${w.message.en}`) });
    }
  }
  return { ok: true, done, moved: await moveInFlightItems(migratorDb) };
}

/** One of the eight submittal Workflows, as `submittalWorkflows` lists it. */
type SubmittalWorkflow = (typeof submittalWorkflows)[number];

/**
 * The Rabaed Default Workflow of Type `typeCode` that publishes `variant`'s document, with its
 * `default_key` and name set (RP-596). `runsIt` is whether the Type runs that document: its own
 * Rabaed Default (`workflow_definition_id`) is then that Workflow and takes the key and the name;
 * each of the other seven is a row of its own, made the first time. A `variant` of null is a Type
 * without the eight: its own Rabaed Default, untouched. Null when the Type has none. The name
 * follows the document list, so renaming one there renames the Workflow on the next publish.
 */
async function ensureRabaedWorkflow(db: Db, typeCode: string, variant: SubmittalWorkflow | null, runsIt: boolean): Promise<string | null> {
  const type = await db
    .selectFrom("work_item_type")
    .select(["id", "workflow_definition_id"])
    .where("owner_kind", "=", "rabaed")
    .where("code", "=", typeCode)
    .executeTakeFirst();
  if (!type) return null;
  if (!variant) return type.workflow_definition_id;
  const existing =
    (await db
      .selectFrom("workflow_definition")
      .select("id")
      .where("work_item_type_id", "=", type.id)
      .where("owner_kind", "=", "rabaed")
      .where("default_key", "=", variant.key)
      .executeTakeFirst())?.id ?? null;
  const id = existing ?? (runsIt ? type.workflow_definition_id : null);
  if (id === null) {
    const inserted = await db
      .insertInto("workflow_definition")
      .values({ owner_kind: "rabaed", name: JSON.stringify(variant.name), work_item_type_id: type.id, default_key: variant.key })
      .returning("id")
      .executeTakeFirstOrThrow();
    return inserted.id;
  }
  const row = await db.selectFrom("workflow_definition").select(["name", "default_key"]).where("id", "=", id).executeTakeFirstOrThrow();
  if (row.default_key !== variant.key || !sameJson(row.name, variant.name)) {
    await db
      .updateTable("workflow_definition")
      .set({ default_key: variant.key, name: JSON.stringify(variant.name), updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }
  return id;
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
