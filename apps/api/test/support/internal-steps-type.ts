// A test-only Rabaed Default Work Item Type whose Workflow has two Consultant Steps,
// for tests that need an item to move inside the Consultant (the seeded MAR has one
// Consultant Step): the Consultant's Engineer, then its Manager, who can Return it to
// the Engineer. The Manager's Step is in another Stage, so the Stage too must stay the
// one the item arrived in. Used by step-age (RP-255) and workflow-map (RP-438).
import type { Db } from "@rabaed/db";
import { sql } from "kysely";

export const INTERNAL_STEPS_TYPE = "MARIN";
export const MANAGER_STEP = "Consultant manager review";

const TYPE = INTERNAL_STEPS_TYPE;
const bilingual = (text: string) => ({ en: text, ar: text });

/** The test-only Rabaed Default Type: Draft → Contractor review → Consultant engineer ⇄ Consultant manager → Approved. */
export async function addInternalConsultantStepsType(migrator: Db) {
  await sql`
    do $$
      declare
        v_definition uuid;
        v_version uuid;
      begin
        if exists (select 1 from work_item_type where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)}) then
          -- Written before Types had Forms: it fills the MAR's.
          update work_item_type set form_definition_id = (select form_definition_id from work_item_type where code = 'MAR')
          where owner_kind = 'rabaed' and code = ${sql.lit(TYPE)} and form_definition_id is null;
          -- Written before Action Forms (RP-300): its Return asks for a reason, as the MAR's.
          update workflow_transition tr set action_form = (
            select mar.action_form from workflow_transition mar
            join work_item_type t on t.code = 'MAR' and t.owner_kind = 'rabaed'
            join workflow_version v on v.workflow_definition_id = t.workflow_definition_id and v.id = mar.workflow_version_id
            where v.version_no = 1 and mar.key = 'return')
          where tr.key = 'return_to_engineer' and tr.action_form is null and tr.workflow_version_id in (
            select v.id from workflow_version v join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
            where t.owner_kind = 'rabaed' and t.code = ${sql.lit(TYPE)});
          return;
        end if;
        insert into workflow_definition (owner_kind, name)
        values ('rabaed', '{"en": "Internal Consultant Steps (test)", "ar": "خطوات داخلية (اختبار)"}')
        returning id into v_definition;
        insert into workflow_version (workflow_definition_id, version_no, status)
        values (v_definition, 1, 'draft')
        returning id into v_version;

        insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
          (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft',
            '{"base_role": "contractor", "permission": "create"}', 'none'),
          (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
            '{"base_role": "contractor", "permission": "review"}', 'none'),
          (v_version, 'consultant_engineer', '{"en": "Consultant engineer review", "ar": "مراجعة مهندس الاستشاري"}',
            'pending_approval', '{"base_role": "consultant", "permission": "review"}', 'none'),
          (v_version, 'consultant_manager', ${sql.lit(JSON.stringify(bilingual(MANAGER_STEP)))}::jsonb,
            'internal_review', '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
          (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none');

        -- Its Return asks for a reason, as the MAR's (RP-300).
        insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form)
        select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort,
          case when t.kind = 'return' then (
            select mar.action_form from workflow_transition mar
            join work_item_type wt on wt.code = 'MAR' and wt.owner_kind = 'rabaed'
            join workflow_version v on v.workflow_definition_id = wt.workflow_definition_id and v.id = mar.workflow_version_id
            where v.version_no = 1 and mar.key = 'return') end
        from (values
          ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
          ('submit', 'internal_review', 'consultant_engineer', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 2),
          ('send_to_manager', 'consultant_engineer', 'consultant_manager', '{"en": "Send to Manager", "ar": "إرسال للمدير"}',
            'send', null, 'review', 3),
          ('return_to_engineer', 'consultant_manager', 'consultant_engineer', '{"en": "Return", "ar": "إعادة"}',
            'return', null, 'approve', 4),
          ('approve_a', 'consultant_manager', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 5)
        ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
        join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
        join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

        -- Published once its parts are in: a published Version takes none (RP-424).
        update workflow_version set status = 'published', published_at = now() where id = v_version;

        -- It is filled with the MAR's Form.
        insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
        values ('rabaed', 'submittals', ${sql.lit(TYPE)}, '{"en": "Internal Steps Submittal", "ar": "اعتماد بخطوات داخلية"}',
          v_definition, 'review_code', (select form_definition_id from work_item_type where code = 'MAR'));
      end
    $$
  `.execute(migrator);
}
