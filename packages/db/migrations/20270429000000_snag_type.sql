-- RP-90 (SNAG-1, spec RP-619): the Snag Type, raised by the Consultant (glossary Snag,
-- Snag List, Stage, Step, Step Age; workflow-engine.md §6, §12; visibility.md scenarios
-- RP-90-1 to RP-90-3).
--
-- Data only, as 20270118000000_rabaed_default_types.sql: the Type, its Stages and Function
-- Permissions. Its Form (apps/admin/forms/SNG.json), Workflow (apps/admin/workflows/SNG.json)
-- and Resolve Screen (apps/admin/screens/snag_resolution.json) are documents that the seed
-- step `pnpm defaults:publish` publishes, after every publish check.
--
-- * The Snag List's Rabaed Default Stages gain In Progress and On Hold (category
--   in_progress) after Open: Draft, Open, In Progress, On Hold, Resolved, Closed. Every
--   existing Project gets them after its own Open, its later Stages moved down two places
--   (a Project with no Open Stage gets them at the end);
--   a new Project copies them with the rest. The Comment Workflow doesn't use them.
-- * Function Permissions in the Snag List: the Contractor's engineer and project manager
--   gain `create` and `close` (a Contractor raises and verifies its own Snags from SNAG-2,
--   RP-622). A Comment's Steps name the Consultant, so a Contractor still can't close one.
--   Both sides' engineers and managers gain `attach`, so whoever raises a Snag adds its
--   photos in its Draft.
-- * The Snag Type (SNG, Snag List, outcome kind none: Closed), with a new, empty Form
--   definition and a Rabaed Default Workflow definition its Version 1 is published into.

-- Stages ---------------------------------------------------------------------------------

update stage set sort = sort + 2, updated_at = now()
where owner_kind = 'rabaed' and module_key = 'snag_list' and key in ('resolved', 'closed');

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'snag_list', 'in_progress', '{"en": "In Progress", "ar": "قيد التنفيذ"}', 'in_progress', 3),
  ('rabaed', 'snag_list', 'on_hold', '{"en": "On Hold", "ar": "معلّقة"}', 'in_progress', 4);

-- Only these two: app.copy_rabaed_stages would also bring back any Stage a Project Admin
-- removed. A Project that already has one of the keys keeps it and gets only the other.
do $$
  declare
    v_project uuid;
    v_after integer;
    v_missing text[];
  begin
    for v_project in select id from project order by id loop
      select array_agg(k.key order by k.n) into v_missing
      from (values ('in_progress', 1), ('on_hold', 2)) as k (key, n)
      where not exists (select 1 from stage x where x.project_id = v_project and x.module_key = 'snag_list' and x.key = k.key);
      continue when v_missing is null;
      v_after := coalesce(
        (select sort from stage where project_id = v_project and module_key = 'snag_list' and key = 'open'),
        (select max(sort) from stage where project_id = v_project and module_key = 'snag_list'),
        0
      );
      update stage set sort = sort + cardinality(v_missing), updated_at = now()
      where project_id = v_project and module_key = 'snag_list' and sort > v_after;
      insert into stage (owner_kind, project_id, module_key, key, name, category, sort)
      select 'project', v_project, d.module_key, d.key, d.name, d.category, v_after + m.n
      from unnest(v_missing) with ordinality as m (key, n)
      join stage d on d.owner_kind = 'rabaed' and d.module_key = 'snag_list' and d.key = m.key;
    end loop;
  end
$$;

-- Function Permissions ---------------------------------------------------------------------

insert into position_permission (position_id, module_key, permission)
select p.id, 'snag_list', x.permission
from (values
  ('contractor', 'engineer', 'create'), ('contractor', 'engineer', 'close'), ('contractor', 'engineer', 'attach'),
  ('contractor', 'project_manager', 'create'), ('contractor', 'project_manager', 'close'),
  ('contractor', 'project_manager', 'attach'),
  ('consultant', 'engineer', 'attach'), ('consultant', 'manager', 'attach')
) as x (base_role, key, permission)
join position p on p.base_role = x.base_role and p.key = x.key
on conflict do nothing;

-- The Type ---------------------------------------------------------------------------------

do $$
  declare
    v_name constant jsonb := '{"en": "Snag", "ar": "عيب"}';
    v_form uuid;
    v_definition uuid;
    v_type uuid;
  begin
    insert into form_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_form;
    insert into workflow_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_definition;
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    values ('rabaed', 'snag_list', 'SNG', v_name, v_definition, 'none', v_form)
    returning id into v_type;
    update workflow_definition set work_item_type_id = v_type where id = v_definition;
  end
$$;
