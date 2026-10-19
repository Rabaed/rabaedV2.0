-- RP-627 (SNAG-5, spec RP-619): the Trade "General" and the Site Observation Type (OBS)
-- (glossary Site Observation, Trade, Visibility; visibility.md scenarios RP-627-1 and RP-627-2).
--
-- * The Trade "General" (code GEN, first in the list: the Trades a Project adds sort after it). The Rabaed Default Trade list is not a table yet: a new
--   Project's Trade Dimension starts empty and a Project Admin adds its Trades. So General
--   goes in where the Dimension is made, app.create_project_dimensions, and every Project that
--   exists gets it here (a Project that already has a Trade coded GEN keeps its own). No
--   Participant's Visibility changes: a Participant whose Trade Visibility is "all" covers it,
--   and a Project Admin grants it like any other Trade.
-- * The Type, data only as 20270429000000_snag_type.sql: the Site Observation (OBS), in the
--   Snag List, with its own empty Form definition and Rabaed Default Workflow definition,
--   outcome kind none (Closed). Its Form (apps/admin/forms/OBS.json, the Snag Form with the
--   Trade defaulting to General) and Workflow (apps/admin/workflows/OBS.json, its own copy of
--   the Snag Workflow) are documents that the seed step `pnpm defaults:publish` publishes.

-- The Trade "General" --------------------------------------------------------------------

create or replace function app.create_project_dimensions() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade uuid;
    begin
      insert into visibility_dimension (project_id, kind, name, required_on_work_items) values
        (new.id, 'trade', '{"en": "Trade", "ar": "التخصص"}', true)
        returning id into v_trade;
      insert into visibility_dimension (project_id, kind, name, required_on_work_items) values
        (new.id, 'location', '{"en": "Location", "ar": "الموقع"}', false);
      insert into dimension_value (project_id, dimension_id, depth, code, name)
        values (new.id, v_trade, 1, 'GEN', '{"en": "General", "ar": "عام"}');
      return new;
    end
  $$;

insert into dimension_value (project_id, dimension_id, depth, code, name)
select d.project_id, d.id, 1, 'GEN', '{"en": "General", "ar": "عام"}'
from visibility_dimension d
where d.kind = 'trade'
on conflict do nothing;

-- The Type -------------------------------------------------------------------------------

do $$
  declare
    v_name constant jsonb := '{"en": "Site Observation", "ar": "ملاحظة موقع"}';
    v_form uuid;
    v_definition uuid;
    v_type uuid;
  begin
    insert into form_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_form;
    insert into workflow_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_definition;
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    values ('rabaed', 'snag_list', 'OBS', v_name, v_definition, 'none', v_form)
    returning id into v_type;
    update workflow_definition set work_item_type_id = v_type where id = v_definition;
  end
$$;
