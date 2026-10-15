// A test-only Rabaed Default Work Item Type that runs the MAR's route before RP-437: the
// MAR Workflow Version 2 (Contractor review, whose Return goes back to the Draft → Submit →
// the Consultant's one review Step, which issues A or C), on the MAR Form Version 3 (no
// Consultant verification: Version 4's, filled by another Participant, retired with
// ADR 0019, and Version 5 has none). The Rabaed Default MAR moved on to Workflow Version 3
// (ADR 0020); the engine's general behaviour is tested on this copy, the Form and the
// Workflow copied from the MAR's own published Versions, as data.
import type { WorkflowDefinition } from "@rabaed/domain";
import type { Db } from "../src/client.ts";
import { sql } from "kysely";

/**
 * The legacy MAR's Type code: "MARV", "the MAR on Workflow Version 2", a test-only Rabaed
 * Default Work Item Type, never in a real database. The seam suites' global setup
 * (seed-demo.ts) adds it: the MAR Form Version 3 on a copy of the MAR Workflow Version 2,
 * as tests of the engine's general behaviour drive it (Submit straight to the
 * Consultant's one Step that issues the Code), and as items started before RP-437 ran.
 */
export const LEGACY_MAR = "MARV";

/** The legacy MAR's Workflow's name, as its items read it. */
export const LEGACY_WORKFLOW_NAME = { en: "Material Submittal (Workflow Version 2, test)", ar: "اعتماد المواد (الإصدار 2، اختبار)" };

/** Adds the Type `code` (once; again does nothing): the MAR Form Version 3 on the MAR Workflow Version 2, in Submittals. */
export async function addLegacyMarType(migrator: Db, code: string): Promise<void> {
  await sql`
    do $$
      declare
        v_form uuid;
        v_definition uuid;
        v_version uuid;
        v_source uuid;
        v_type uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(code)}) then
          return;
        end if;
        insert into form_definition (owner_kind, name)
        values ('rabaed', '{"en": "Material Submittal (Form Version 3, test)", "ar": "اعتماد مواد (اختبار)"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        select v_form, 1, 'published', now(), f.schema
        from form_version f join work_item_type t on t.form_definition_id = f.form_definition_id
        where t.owner_kind = 'rabaed' and t.code = 'MAR' and f.version_no = 3;

        select v.id into v_source from workflow_version v
        join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
        where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.version_no = 2;
        insert into workflow_definition (owner_kind, name)
        values ('rabaed', ${sql.lit(JSON.stringify(LEGACY_WORKFLOW_NAME))}::jsonb)
        returning id into v_definition;
        -- Built as a draft, then published: a published Version takes no new parts (RP-424).
        insert into workflow_version (workflow_definition_id, version_no, status, layout)
        values (v_definition, 1, 'draft', '{}') returning id into v_version;
        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, is_signing, outcome_mode)
        select v_version, key, name, stage_key, actor_rule, is_signing, outcome_mode from workflow_step where workflow_version_id = v_source;
        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form)
        select v_version, t.key, f2.id, s2.id, t.label, t.kind, t.outcome, t.permission, t.sort, t.action_form
        from workflow_transition t
        join workflow_step f1 on f1.id = t.from_step_id
        join workflow_step s1 on s1.id = t.to_step_id
        join workflow_step f2 on f2.workflow_version_id = v_version and f2.key = f1.key
        join workflow_step s2 on s2.workflow_version_id = v_version and s2.key = s1.key
        where t.workflow_version_id = v_source;
        update workflow_version set status = 'published', published_at = now() where id = v_version;

        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', ${sql.lit(code)}, '{"en": "Material Approval Request (before RP-437, test)", "ar": "طلب اعتماد مواد (قبل RP-437، اختبار)"}',
          v_definition, 'review_code', v_form)
        returning id into v_type;
        update workflow_definition set work_item_type_id = v_type where id = v_definition;
      end
    $$
  `.execute(migrator);
}

/**
 * `definition` (a copy of the legacy MAR's route) with its Return kept in Internal Review,
 * as publishing asks since RP-437 (ADR 0020, `return_to_draft`): the Return goes to a
 * Contractor Engineer Step there, which sends it for review again. Unchanged when no
 * Return goes into the Draft Step. For tests that publish a copy of the legacy route.
 */
export function returnInInternalReview(definition: WorkflowDefinition): WorkflowDefinition {
  const draft = definition.steps.find((s) => s.stage === "draft");
  const back = definition.transitions.find((t) => t.kind === "return" && t.to === draft?.key);
  if (!draft || !back || !draft.actor) return definition;
  return {
    ...definition,
    steps: [
      ...definition.steps,
      { key: "contractor_engineer", name: { en: "Contractor Engineer", ar: "مهندس المقاول" }, stage: "internal_review", actor: draft.actor, outcomeMode: "none" },
    ],
    transitions: [
      ...definition.transitions.map((t) => (t === back ? { ...t, to: "contractor_engineer" } : t)),
      {
        key: "send_for_review_again",
        label: { en: "Send for Review", ar: "إرسال للمراجعة" },
        kind: "send",
        from: "contractor_engineer",
        to: back.from,
        outcome: null,
        permission: draft.actor.permission,
        actionForm: null,
      },
    ],
  };
}
