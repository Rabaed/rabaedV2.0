// Seam 1: every publish check over every published Workflow Version (RP-425, spec
// RP-423; workflow-engine.md §1). Versions published by migration skipped the checks
// the authoring commands (WF-4, RP-427) run, so this
// runs workflowPublishProblems on each of them, with its Work Item Type, the
// Module's Stages and the Type's latest published Form, as publishing will. Each
// Version's rows also read as a definition and write back as the same rows.
import { createDb } from "@rabaed/db";
import { testDatabaseUrls } from "@rabaed/db/test-support";
import {
  definitionFromRows,
  definitionToRows,
  formSchema,
  workflowPublishProblems,
  type OutcomeKind,
  type StageCategory,
  type WorkflowVersionRows,
} from "@rabaed/domain";
import { sql } from "kysely";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addActionsType, addRulesType } from "./support/rules.ts";
import { addSendBackType } from "./support/send-back.ts";

const migrator = createDb(testDatabaseUrls().migrator, { max: 1 });
afterAll(async () => {
  await migrator.destroy();
});

type Version = {
  id: string;
  name: string;
  versionNo: number;
  layout: unknown;
  typeId: string | null;
  moduleKey: string | null;
  projectId: string | null;
  /** The Project owning the Workflow; null for a Rabaed Default. */
  ownerProjectId: string | null;
  outcomeKind: OutcomeKind | null;
  form: unknown;
};

let versions: Version[] = [];
let rows: Map<string, WorkflowVersionRows>;

beforeAll(async () => {
  // A Workflow with rules (WF-7) is among them, whichever tests ran first.
  await addRulesType(migrator, "WFRUL");
  // A Workflow with actions (WF-8) is among them, whichever tests ran first.
  await addActionsType(migrator, "WFACT");
  const sendBackForm = {
    sections: [
      { key: "material", title: { en: "Material", ar: "المادة" }, fields: [{ key: "model", type: "text", label: { en: "Model", ar: "الطراز" } }] },
      {
        key: "classification",
        title: { en: "Classification", ar: "التصنيف" },
        fields: [
          { key: "trade", type: "trade", label: { en: "Trade", ar: "التخصص" } },
          { key: "location", type: "location", label: { en: "Location", ar: "الموقع" } },
          { key: "scopes", type: "scopes", label: { en: "Scopes", ar: "النطاقات" } },
        ],
      },
    ],
  };
  // A Workflow with Send Backs is among them, whichever tests ran first.
  await addSendBackType(migrator, "WFDEF", { en: "Workflow definition check", ar: "فحص تعريف سير العمل" }, sendBackForm);
  // And one with Cancels and a Step that Recommends a Code (RP-433).
  await addSendBackType(migrator, "WFCNL", { en: "Cancel check", ar: "فحص الإلغاء" }, sendBackForm, { withCancel: true, recommendCode: true });
  versions = (
    await sql<Version>`
      select v.id, d.name ->> 'en' as name, v.version_no as "versionNo", v.layout,
        t.id as "typeId", t.module_key as "moduleKey", coalesce(d.project_id, t.project_id) as "projectId", d.project_id as "ownerProjectId",
        t.outcome_kind as "outcomeKind",
        (select f.schema from form_version f
         where f.form_definition_id = t.form_definition_id and f.status = 'published'
         order by f.version_no desc limit 1) as form
      from workflow_version v
      join workflow_definition d on d.id = v.workflow_definition_id
      -- The Type the Workflow was made for (RP-427: its own), else the first that has it as
      -- its Rabaed Default, else the first a Project binds it to (WF-3, RP-426), checked
      -- against that Project's Stages. Test Types reuse the MAR's Workflow as a shortcut,
      -- even in other Modules (a WIR), which no publish would allow.
      left join lateral (
        select wt.* from (
          select wt.*, 0 as via from work_item_type wt where wt.id = d.work_item_type_id
          union all
          select wt.*, 1 as via from work_item_type wt where wt.workflow_definition_id = d.id
          union all
          select wt.*, 2 as via from workflow_binding b join work_item_type wt on wt.id = b.work_item_type_id
          where b.workflow_definition_id = d.id
        ) wt order by wt.via, wt.created_at, wt.id limit 1
      ) t on true
      where v.status = 'published'
      order by d.created_at, v.version_no
    `.execute(migrator)
  ).rows;
  const steps = await sql<WorkflowVersionRows["steps"][number] & { version: string }>`
    select s.workflow_version_id as version, s.key, s.name, s.stage_key, s.actor_rule, s.is_signing, s.outcome_mode
    from workflow_step s join workflow_version v on v.id = s.workflow_version_id
    where v.status = 'published'
    order by s.created_at, s.key
  `.execute(migrator);
  const transitions = await sql<WorkflowVersionRows["transitions"][number] & { version: string }>`
    select tr.workflow_version_id as version, tr.key, f.key as from_step_key, s.key as to_step_key, tr.label, tr.kind, tr.outcome,
      tr.permission, tr.sort, tr.action_form, tr.rules, tr.actions
    from workflow_transition tr
    join workflow_version v on v.id = tr.workflow_version_id
    join workflow_step f on f.id = tr.from_step_id
    join workflow_step s on s.id = tr.to_step_id
    where v.status = 'published'
    order by tr.sort
  `.execute(migrator);
  rows = new Map(
    versions.map((v) => [
      v.id,
      {
        layout: v.layout,
        steps: steps.rows.filter((s) => s.version === v.id).map(({ version: _, ...s }) => s),
        // A Transition without rules or actions has a null column, and no such key as a row.
        transitions: transitions.rows
          .filter((t) => t.version === v.id)
          .map(({ version: _, rules, actions, ...t }) => ({ ...t, ...(rules === null ? {} : { rules }), ...(actions === null ? {} : { actions }) })),
      },
    ]),
  );
});

describe("every published Workflow Version", () => {
  it("includes MAR Versions 1 and 2, each used by a Work Item Type", () => {
    expect(versions.filter((v) => v.name === "Material Submittal (MAR)").map((v) => [v.versionNo, v.outcomeKind])).toEqual([
      [1, "review_code"],
      [2, "review_code"],
    ]);
    expect(versions.filter((v) => v.typeId === null).map((v) => v.name)).toEqual([]);
  });

  it("reads as a definition and writes back as the same rows", () => {
    const changed = versions.filter((v) => {
      const stored = rows.get(v.id)!;
      return !isDeepStrictEqual(definitionToRows(definitionFromRows(stored), v.outcomeKind!), stored);
    });
    expect(changed.map((v) => `${v.name} v${v.versionNo}`)).toEqual([]);
  });

  it("passes every publish check", async () => {
    const stages = await sql<{ moduleKey: string; projectId: string | null; key: string; category: StageCategory }>`
      select module_key as "moduleKey", project_id as "projectId", key, category from stage order by sort
    `.execute(migrator);
    const lists = await sql<{ id: string }>`select id from option_list`.execute(migrator);
    const outcomes = await sql<{ typeId: string; projectId: string | null; code: string; closing: boolean }>`
      select work_item_type_id as "typeId", project_id as "projectId", code, closing from outcome order by sort
    `.execute(migrator);
    const problems = versions.flatMap((v) =>
      workflowPublishProblems(definitionFromRows(rows.get(v.id)!), {
        // The Type's outcome set it is published against (RP-429): its Project's copy for a Project's own Workflow, else the Rabaed Default set.
        outcomes: outcomes.rows.filter((o) => o.typeId === v.typeId && o.projectId === v.ownerProjectId),
        // The Stage set it is published against (RP-428): its Project's for a Project's own Workflow, else the Rabaed Defaults'.
        stages: stages.rows.filter((s) => s.moduleKey === v.moduleKey && s.projectId === v.ownerProjectId),
        form: v.form === null ? null : formSchema.parse(v.form),
        optionListIds: new Set(lists.rows.map((l) => l.id)),
      }).map((p) => ({ version: `${v.name} v${v.versionNo}`, code: p.code, step: p.step, transition: p.transition, message: p.message.en })),
    );
    expect(problems).toEqual([]);
  });
});
