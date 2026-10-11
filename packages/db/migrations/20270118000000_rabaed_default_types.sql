-- The Rabaed Default Work Item Types for the Rabaed Default Workflows (RP-437, WF-14;
-- spec RP-423, RP-511; workflow-engine.md §1 "Rabaed Defaults", §6; ADR 0019, 0020).
--
-- Data only: the Types, their Stages and Function Permissions, and the Rabaed Default
-- outcome set of Inspection Results. The Workflows, Forms and Screens themselves are
-- not written here: they are JSON documents (apps/admin/workflows, apps/admin/forms,
-- apps/admin/screens) that the seed step `pnpm defaults:publish` publishes through
-- the same commands as `pnpm workflow:publish` and `pnpm form:publish`, after every
-- publish check. Until it runs, the new Types have no published Workflow Version and
-- no item of theirs can be created.
--
-- * Submittals: Shop Drawing (SAR) and Document (DAR) submittals, the MAR's shape, on
--   the MAR's Form until their own Forms exist (the Type points at the MAR's Form
--   definition, so a new MAR Form Version reaches them too); and the Stage "Rejected"
--   (closed negative) that Code D closes into, copied into every Project by
--   stage_rabaed_default_copied.
-- * Inspections: the Work Inspection Request (WIR, Inspection Results) and the
--   Non-Conformance Report (NCR, Approval), each with an empty Form definition its
--   Version 1 is published into. The Module's Rabaed Default Stages and the Rabaed
--   Positions' Function Permissions there: the Contractor raises a WIR (engineer
--   `create`, its PM `review` and `submit`, which also answers an NCR); the
--   Consultant inspects and raises NCRs (`create`, `review`, `approve`).
-- * Inspection Results (app.default_outcomes, as @rabaed/domain defaultOutcomeSets):
--   Passed with Comments creates Comments (`create_items` CMT, as Code B) and Failed
--   offers a Revision, the re-inspection (`offer_revision`, as Code C). No Type had
--   the set until now, so no stored outcome changes.

-- Stages ---------------------------------------------------------------------------------

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'submittals', 'rejected', '{"en": "Rejected", "ar": "مرفوض"}', 'closed_negative', 7);

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'inspections', 'draft', '{"en": "Drafts", "ar": "المسودات"}', 'draft', 1),
  ('rabaed', 'inspections', 'internal_review', '{"en": "Internal Review", "ar": "المراجعة الداخلية"}', 'in_progress', 2),
  ('rabaed', 'inspections', 'pending_inspection', '{"en": "Pending Inspection", "ar": "بانتظار المعاينة"}', 'in_progress', 3),
  ('rabaed', 'inspections', 'pending_response', '{"en": "Pending Response", "ar": "بانتظار الرد"}', 'in_progress', 4),
  ('rabaed', 'inspections', 'under_review', '{"en": "Under Review", "ar": "قيد المراجعة"}', 'in_progress', 5),
  ('rabaed', 'inspections', 'passed', '{"en": "Passed", "ar": "ناجح"}', 'closed_positive', 6),
  ('rabaed', 'inspections', 'failed', '{"en": "Failed", "ar": "راسب"}', 'closed_negative', 7),
  ('rabaed', 'inspections', 'closed', '{"en": "Closed", "ar": "مغلق"}', 'closed_positive', 8),
  ('rabaed', 'inspections', 'rejected', '{"en": "Rejected", "ar": "مرفوض"}', 'closed_negative', 9),
  ('rabaed', 'inspections', 'cancelled', '{"en": "Cancelled", "ar": "ملغى"}', 'cancelled', 10);

insert into position_permission (position_id, module_key, permission)
select p.id, 'inspections', x.permission
from (values
  ('contractor', 'engineer', 'view'), ('contractor', 'engineer', 'create'), ('contractor', 'engineer', 'attach'),
  ('contractor', 'project_manager', 'view'), ('contractor', 'project_manager', 'create'),
  ('contractor', 'project_manager', 'attach'), ('contractor', 'project_manager', 'review'),
  ('contractor', 'project_manager', 'submit'),
  ('consultant', 'engineer', 'view'), ('consultant', 'engineer', 'create'), ('consultant', 'engineer', 'attach'),
  ('consultant', 'engineer', 'review'), ('consultant', 'engineer', 'approve'),
  ('consultant', 'manager', 'view'), ('consultant', 'manager', 'create'), ('consultant', 'manager', 'attach'),
  ('consultant', 'manager', 'review'), ('consultant', 'manager', 'approve'),
  ('owner', 'representative', 'view'),
  ('owner_representative', 'engineer', 'view')
) as x (base_role, key, permission)
join position p on p.base_role = x.base_role and p.key = x.key
on conflict do nothing;

-- Inspection Results ------------------------------------------------------------------------

-- As in 20270102000000_outcome_sets.sql, with Passed with Comments' and Failed's follow-up actions.
create or replace function app.default_outcomes(p_kind text)
  returns table (code text, name jsonb, closing boolean, polarity text, actions jsonb, sort integer)
  language sql immutable
  as $$
    select d.code, d.name::jsonb, true, d.polarity, d.actions::jsonb, d.sort
    from (values
      ('review_code', 'A', '{"en": "Approved", "ar": "معتمد"}', 'positive', '[]', 1),
      ('review_code', 'B', '{"en": "Approved with Comments", "ar": "معتمد مع ملاحظات"}', 'positive',
        '[{"kind": "create_items", "type": "CMT"}]', 2),
      ('review_code', 'C', '{"en": "Revise and Resubmit", "ar": "يُراجع ويُعاد تقديمه"}', 'negative', '[{"kind": "offer_revision"}]', 3),
      ('review_code', 'D', '{"en": "Rejected", "ar": "مرفوض"}', 'negative', '[{"kind": "offer_replacement"}]', 4),
      ('inspection_result', 'passed', '{"en": "Passed", "ar": "ناجح"}', 'positive', '[]', 1),
      ('inspection_result', 'passed_with_comments', '{"en": "Passed with Comments", "ar": "ناجح مع ملاحظات"}', 'positive',
        '[{"kind": "create_items", "type": "CMT"}]', 2),
      ('inspection_result', 'failed', '{"en": "Failed", "ar": "راسب"}', 'negative', '[{"kind": "offer_revision"}]', 3),
      ('approval', 'approved', '{"en": "Approved", "ar": "معتمد"}', 'positive', '[]', 1),
      ('approval', 'rejected', '{"en": "Rejected", "ar": "مرفوض"}', 'negative', '[]', 2),
      ('none', 'closed', '{"en": "Closed", "ar": "مغلق"}', 'positive', '[]', 1)
    ) as d (kind, code, name, polarity, actions, sort)
    where d.kind = p_kind
    order by d.sort
  $$;
revoke all on function app.default_outcomes(text) from public;

-- The Types ----------------------------------------------------------------------------------

-- Each with a Rabaed Default Workflow definition of its own (no Version yet: `pnpm
-- defaults:publish` publishes it), and the MAR's Form definition or (null) a new,
-- empty one named as the Type. Its outcome set is seeded by work_item_type_outcomes.
do $$
  declare
    v_mar_form uuid := (select form_definition_id from work_item_type where owner_kind = 'rabaed' and code = 'MAR');
    v_new record;
    v_form uuid;
    v_definition uuid;
    v_type uuid;
  begin
    for v_new in
      select * from (values
        (1, 'submittals', 'SAR', '{"en": "Shop Drawing Submittal", "ar": "اعتماد المخططات التنفيذية"}'::jsonb, 'review_code', true),
        (2, 'submittals', 'DAR', '{"en": "Document Submittal", "ar": "اعتماد المستندات"}'::jsonb, 'review_code', true),
        (3, 'inspections', 'WIR', '{"en": "Work Inspection Request", "ar": "طلب معاينة أعمال"}'::jsonb, 'inspection_result', false),
        (4, 'inspections', 'NCR', '{"en": "Non-Conformance Report", "ar": "تقرير عدم مطابقة"}'::jsonb, 'approval', false)
      ) as t (n, module_key, code, name, outcome_kind, mar_form)
      order by n
    loop
      if v_new.mar_form then
        v_form := v_mar_form;
      else
        insert into form_definition (owner_kind, name) values ('rabaed', v_new.name) returning id into v_form;
      end if;
      insert into workflow_definition (owner_kind, name) values ('rabaed', v_new.name) returning id into v_definition;
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      values ('rabaed', v_new.module_key, v_new.code, v_new.name, v_definition, v_new.outcome_kind, v_form)
      returning id into v_type;
      update workflow_definition set work_item_type_id = v_type where id = v_definition;
    end loop;
  end
$$;
