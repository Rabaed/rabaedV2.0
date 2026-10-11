// A test-only Rabaed Default Work Item Type that runs as a MAR did before RP-437: the MAR
// Form Version 4 (with the Consultant verification filled by the Consultant at its
// review Step, ADR 0013, V19) on the MAR Workflow Version 2 (Contractor review →
// Consultant review, which issues A or C). The Rabaed Default MAR moved on to Form
// Version 5 and Workflow Version 3 (ADR 0019, ADR 0020); items started before keep
// these, so the tests of what they do run on this copy: the Form and the Workflow are
// copied from the MAR's own published Versions, as data.
import type { Db } from "../src/client.ts";
import { sql } from "kysely";

/**
 * The legacy MAR's Type code, added by the seam suites' global setup (seed-demo.ts): the
 * MAR as tests of the engine's general behaviour drive it (Submit straight to the
 * Consultant's one Step that issues the Code), and as items started before RP-437 run.
 */
export const LEGACY_MAR = "MARV";

/** The legacy MAR's Workflow's name, as its items read it. */
export const LEGACY_WORKFLOW_NAME = { en: "Material Submittal (Workflow Version 2, test)", ar: "اعتماد المواد (الإصدار 2، اختبار)" };

/** Adds the Type `code` (once; again does nothing): the MAR Form Version 4 on the MAR Workflow Version 2, in Submittals. */
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
        values ('rabaed', '{"en": "Material Submittal (Form Version 4, test)", "ar": "اعتماد مواد (اختبار)"}')
        returning id into v_form;
        insert into form_version (form_definition_id, version_no, status, published_at, schema)
        select v_form, 1, 'published', now(), f.schema
        from form_version f join work_item_type t on t.form_definition_id = f.form_definition_id
        where t.owner_kind = 'rabaed' and t.code = 'MAR' and f.version_no = 4;

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
        values ('rabaed', 'submittals', ${sql.lit(code)}, '{"en": "Material Submittal (before RP-437, test)", "ar": "اعتماد المواد (قبل RP-437، اختبار)"}',
          v_definition, 'review_code', v_form)
        returning id into v_type;
        update workflow_definition set work_item_type_id = v_type where id = v_definition;
      end
    $$
  `.execute(migrator);
}
