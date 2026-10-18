-- RP-626 (SNAG-6, spec RP-619): the Question Types, Question to Consultant (QSN) and Question
-- to Contractor (QSC) (glossary Question, Snag List, Stage, Step; workflow-engine.md §12;
-- visibility.md scenarios RP-626-1 to RP-626-4).
--
-- Data only, as 20270429000000_snag_type.sql: the two Types and a Function Permission. Their
-- shared Form (apps/admin/forms/QST.json), Workflows (apps/admin/workflows/QSN.json and
-- QSC.json) and the answer Screen (apps/admin/screens/question_answer.json) are documents that
-- the seed step `pnpm defaults:publish` publishes, after every publish check.
--
-- * No new Stage: Open, Answered (a Step in the Resolved Stage) and Closed use the Snag List's.
-- * Function Permissions: the Consultant's engineer and manager gain `submit` in the Snag List,
--   to answer a Question asked of them. The Contractor's Positions already hold `submit`, `create`
--   and `close` (RP-90). A Comment's Steps name roles, so a Consultant still can't act on a
--   Contractor's Comment Step.
-- * Two Types, each with its own empty Form definition and Rabaed Default Workflow definition,
--   outcome kind none (Closed): QSN, raised by a Contractor, Open with the Consultant; QSC,
--   raised by a Consultant, Open with the Contractor.

-- Function Permissions ---------------------------------------------------------------------

insert into position_permission (position_id, module_key, permission)
select p.id, 'snag_list', 'submit'
from position p
where p.owner_kind = 'rabaed' and p.base_role = 'consultant' and p.key in ('engineer', 'manager')
on conflict do nothing;

-- The Types --------------------------------------------------------------------------------

do $$
  declare
    v_type record;
    v_form uuid;
    v_definition uuid;
    v_type_id uuid;
  begin
    for v_type in
      select * from (values
        ('QSN', '{"en": "Question to Consultant", "ar": "سؤال إلى الاستشاري"}'::jsonb),
        ('QSC', '{"en": "Question to Contractor", "ar": "سؤال إلى المقاول"}'::jsonb)
      ) as t (code, name)
    loop
      insert into form_definition (owner_kind, name) values ('rabaed', v_type.name) returning id into v_form;
      insert into workflow_definition (owner_kind, name) values ('rabaed', v_type.name) returning id into v_definition;
      insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
      values ('rabaed', 'snag_list', v_type.code, v_type.name, v_definition, 'none', v_form)
      returning id into v_type_id;
      update workflow_definition set work_item_type_id = v_type_id where id = v_definition;
    end loop;
  end
$$;
