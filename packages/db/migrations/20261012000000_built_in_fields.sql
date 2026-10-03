-- The Built-in Fields inside the Form: Trade, Location and Scopes
-- (form-engine.md §1; RP-270, spec RP-261).
--
-- * Every Form places Trade, Location and Scopes / Sub-scopes as Built-in Fields,
--   keyed by their type. The Work Item's Trade and Location (which drive
--   visibility and Consultant routing) and its Scopes come from these answers.
--   The skeleton's hard-coded Trade and Location inputs move into the Form.
-- * The values stay where visibility reads them: Trade and Location in
--   work_item_dimension_value, Scopes in the new work_item_scope. They are never
--   copied into work_item.data, so there is one source for each.
--   app.work_item_answers puts them back among the answers, as the Form shows them.
-- * Trade and Location are always required; the shared validator (in the API)
--   enforces it whatever the schema says: Trade even in a Draft (no Work Item
--   exists without one), Location to leave Draft. The database keeps Trade
--   required, the values in the Project, within the saver's own Visibility, and
--   Scopes within the chosen Trade.
-- * app.answers_sha256 now covers the Built-in Fields, so a Transition out of
--   Draft moves exactly the Trade, Location and Scopes the API found complete.
-- * The MAR Form Version 1 places Trade, Location and Scopes in a Classification
--   section between its material details and its description. It was published
--   by the form versions migration earlier in this same spec, before any item was
--   filled with it outside dev, which holds demo data only and is re-seeded; it is
--   completed here in place rather than as a Version 2 (RP-272 completes it).
--
-- Deferred: Visibility Dimensions a Project marks as required on Work Items
-- (custom dimensions don't exist yet; their Built-in Fields come with them).

-- Scopes on a Work Item ------------------------------------------------------------

alter table scope add constraint scope_id_project_key unique (id, project_id);

-- Many per item, all under the item's Trade (checked by the functions that write
-- them, the only writers). Not a Visibility Dimension: never grants or restricts access.
create table work_item_scope (
  work_item_id uuid not null,
  project_id uuid not null,
  scope_id uuid not null,
  primary key (work_item_id, scope_id),
  constraint work_item_scope_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint work_item_scope_scope_fk foreign key (scope_id, project_id) references scope (id, project_id)
);
create index work_item_scope_scope_id_idx on work_item_scope (scope_id);

alter table work_item_scope enable row level security;
revoke insert, update, delete, truncate on work_item_scope from rabaed_app;
grant select on work_item_scope to rabaed_app;
-- Exactly when the item is visible (the subquery is itself filtered).
create policy member_reads_visible_work_item_scopes on work_item_scope for select to rabaed_app
  using (work_item_id in (select id from work_item));

-- The answers, Built-in Fields included -----------------------------------------------

-- A visible item's answers as its Form shows them: work_item.data with the
-- Built-in Fields `trade`, `location` and `scopes` (ids, Scopes in a fixed
-- order); null for an item the caller can't see (it reads through their RLS).
create function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select (w.data - array['trade', 'location', 'scopes']) || jsonb_strip_nulls(jsonb_build_object(
      'trade', (
        select dv.dimension_value_id from work_item_dimension_value dv
        join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade'
        where dv.work_item_id = w.id),
      'location', (
        select dv.dimension_value_id from work_item_dimension_value dv
        join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'location'
        where dv.work_item_id = w.id),
      'scopes', (select jsonb_agg(s.scope_id order by s.scope_id) from work_item_scope s where s.work_item_id = w.id)
    ))
    from work_item w where w.id = p_work_item_id
  $$;

-- As before, over the answers with their Built-in Fields.
create or replace function app.answers_sha256(p_work_item_id uuid) returns bytea
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(app.work_item_answers(p_work_item_id)::text, 'UTF8'))
  $$;

-- Writing the Built-in Fields ----------------------------------------------------------

-- Whether Trade, Location and Scopes may be written on a Work Item of
-- p_project_id (null p_work_item_id: a new one), for app.create_work_item and
-- app.save_work_item_answers, which have checked who acts, and when.
-- p_project_member_id is the acting Member, whose own Visibility must cover the
-- Trade and Location, so they can always see what they write. A Scope must be of
-- the Trade, a Sub-scope also under a chosen Scope, and either active or already
-- on the item (a deactivated one stays where it is used, but isn't chosen anew).
-- Outcome: 'ok', 'trade_required', 'value_not_found' or 'outside_visibility'.
create function app.check_work_item_built_ins(
  p_work_item_id uuid, p_project_id uuid, p_project_member_id uuid,
  p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[]
) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade_dimension uuid := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension uuid := app.project_dimension_id(p_project_id, 'location');
      v_scope_ids uuid[] := array(select distinct x from unnest(coalesce(p_scope_ids, '{}')) x where x is not null);
    begin
      if p_trade_id is null then
        return 'trade_required';
      end if;
      if not exists (select 1 from dimension_value where id = p_trade_id and dimension_id = v_trade_dimension)
        or (p_location_id is not null
          and not exists (select 1 from dimension_value where id = p_location_id and dimension_id = v_location_dimension))
        or exists (
          select 1 from unnest(v_scope_ids) chosen (id)
          where not exists (
            select 1 from scope s
            where s.id = chosen.id and s.project_id = p_project_id and s.trade_value_id = p_trade_id
              and (s.parent_id is null or s.parent_id = any (v_scope_ids))
              and (s.status = 'active' or exists (
                select 1 from work_item_scope ws where ws.work_item_id = p_work_item_id and ws.scope_id = s.id))
          ))
      then
        return 'value_not_found';
      end if;
      if p_trade_id not in (select app.values_covered_by_project_member(p_project_member_id, v_trade_dimension))
        or (p_location_id is not null
          and p_location_id not in (select app.values_covered_by_project_member(p_project_member_id, v_location_dimension)))
      then
        return 'outside_visibility';
      end if;
      return 'ok';
    end
  $$;

-- Writes a Work Item's Trade, Location and Scopes, once
-- app.check_work_item_built_ins has answered 'ok' for them.
create function app.set_work_item_built_ins(
  p_work_item_id uuid, p_project_id uuid, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[]
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade_dimension uuid := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension uuid := app.project_dimension_id(p_project_id, 'location');
      v_scope_ids uuid[] := array(select distinct x from unnest(coalesce(p_scope_ids, '{}')) x where x is not null);
    begin
      delete from work_item_dimension_value
      where work_item_id = p_work_item_id and dimension_id in (v_trade_dimension, v_location_dimension);
      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select p_work_item_id, p_project_id, d.dimension_id, d.value_id
      from (values (v_trade_dimension, p_trade_id), (v_location_dimension, p_location_id)) as d (dimension_id, value_id)
      where d.value_id is not null;

      delete from work_item_scope where work_item_id = p_work_item_id and scope_id <> all (v_scope_ids);
      insert into work_item_scope (work_item_id, project_id, scope_id)
      select p_work_item_id, p_project_id, x from unnest(v_scope_ids) x
      on conflict do nothing;
    end
  $$;

-- Creating a Draft -------------------------------------------------------------------

drop function app.create_work_item(uuid, text, text, uuid, jsonb, uuid, uuid, timestamptz);

-- As in the form versions migration, with the Built-in Fields: p_trade_id,
-- p_location_id and p_scope_ids are the answers to `trade`, `location` and
-- `scopes`, which the API takes out of p_data. Outcomes as before
-- ('value_not_found' also for a Scope outside the Trade).
create function app.create_work_item(
  p_project_id uuid, p_type_code text, p_title text, p_form_version_id uuid, p_data jsonb,
  p_trade_id uuid, p_location_id uuid, p_now timestamptz, p_scope_ids uuid[] default '{}'
) returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_project_member_id uuid;
      v_participant_id uuid;
      v_base_role text;
      v_type record;
      v_version_id uuid;
      v_step record;
      v_item_id uuid;
      v_outcome text;
    begin
      select pm.id, pm.participant_id, r.base_role into v_project_member_id, v_participant_id, v_base_role
      from project_member pm
      join participant p on p.id = pm.participant_id
      join project_role r on r.id = p.project_role_id
      where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
        and p.status = 'active' and p.company_id = app.current_company_id()
        and p_project_id in (select app.current_project_ids());
      if v_project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;

      select t.id, t.module_key, t.workflow_definition_id into v_type
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = p_type_code;
      if v_type.id is null then
        return query select 'type_not_found'::text, null::uuid;
        return;
      end if;
      -- New items use the latest published Form Version, and stay on it.
      if p_form_version_id is distinct from app.latest_form_version(p_type_code) then
        return query select 'form_version_not_latest'::text, null::uuid;
        return;
      end if;
      -- And the latest published Workflow version.
      select v.id into v_version_id from workflow_version v
      where v.workflow_definition_id = v_type.workflow_definition_id and v.status = 'published'
      order by v.version_no desc limit 1;
      -- The start: the one Step in a Stage of category draft.
      select s.id, s.stage_key, s.actor_rule into v_step
      from workflow_step s
      join stage st on st.owner_kind = 'rabaed' and st.module_key = v_type.module_key and st.key = s.stage_key
      where s.workflow_version_id = v_version_id and st.category = 'draft';
      if v_step.actor_rule ->> 'base_role' is distinct from v_base_role then
        raise exception 'only a % can raise this Work Item Type', initcap(v_step.actor_rule ->> 'base_role')
          using errcode = '42501';
      end if;
      v_outcome := app.check_work_item_built_ins(
        null, p_project_id, v_project_member_id, p_trade_id, p_location_id, p_scope_ids);
      if v_outcome <> 'ok' then
        return query select v_outcome, null::uuid;
        return;
      end if;

      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at, created_at, updated_at
      ) values (
        p_project_id, v_type.id, v_participant_id, app.current_member_id(), btrim(p_title),
        coalesce(p_data, '{}') - array['trade', 'location', 'scopes'],
        v_version_id, p_form_version_id, v_step.id, v_step.stage_key, v_at, v_at, v_at
      ) returning id into v_item_id;
      perform app.set_work_item_built_ins(v_item_id, p_project_id, p_trade_id, p_location_id, p_scope_ids);

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_item_id, p_project_id, v_participant_id, v_at, 'raised');

      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (p_project_id, v_item_id, v_step.id, v_participant_id, app.current_member_id(), 'claimed', v_at, v_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        p_project_id, v_item_id, 'created', app.current_member_id(), v_participant_id, v_step.id,
        jsonb_build_object('title', btrim(p_title)), 'internal', v_participant_id, v_at
      );

      return query select 'created'::text, v_item_id;
    end
  $$;

-- Saving the answers -----------------------------------------------------------------

drop function app.save_work_item_answers(uuid, jsonb, timestamptz);

-- As in the form versions migration, with the Built-in Fields: p_data holds the
-- Form's own answers, p_trade_id, p_location_id and p_scope_ids the answers to
-- `trade`, `location` and `scopes`. Outcome: 'saved', 'not_found',
-- 'project_closed', 'not_editable', 'trade_required', 'value_not_found' or
-- 'outside_visibility' (nothing is saved then).
create function app.save_work_item_answers(
  p_work_item_id uuid, p_data jsonb, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_outcome text;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so a Transition out of Draft checks exactly the answers it moves with.
      select w.*, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      v_outcome := app.check_work_item_built_ins(
        p_work_item_id, v_item.project_id, v_me.project_member_id, p_trade_id, p_location_id, p_scope_ids);
      if v_outcome <> 'ok' then
        return v_outcome;
      end if;
      perform app.set_work_item_built_ins(p_work_item_id, v_item.project_id, p_trade_id, p_location_id, p_scope_ids);
      update work_item set data = coalesce(p_data, '{}') - array['trade', 'location', 'scopes'], updated_at = v_at
      where id = p_work_item_id;
      return 'saved';
    end
  $$;

-- The MAR Form Version 1 places the Built-in Fields -----------------------------------

alter table form_version disable trigger form_version_published_frozen;
update form_version v set schema = jsonb_set(v.schema, '{sections}',
  jsonb_build_array(v.schema -> 'sections' -> 0)
  || jsonb_build_array($section$
    {
      "key": "classification",
      "title": { "en": "Classification", "ar": "التصنيف" },
      "fields": [
        { "key": "trade", "type": "trade", "required": true,
          "label": { "en": "Trade", "ar": "التخصص" } },
        { "key": "location", "type": "location", "required": true,
          "label": { "en": "Location", "ar": "الموقع" } },
        { "key": "scopes", "type": "scopes", "required": false,
          "label": { "en": "Scopes", "ar": "النطاقات" },
          "help": { "en": "The Scopes of the chosen Trade this material is for.",
                    "ar": "نطاقات التخصص المختار التي تخصها هذه المادة." } }
      ]
    }
  $section$::jsonb)
  || jsonb_path_query_array(v.schema -> 'sections', '$[1 to last]'))
from work_item_type t
where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.form_definition_id = t.form_definition_id and v.version_no = 1
  and not jsonb_path_exists(v.schema, '$.sections[*].fields[*] ? (@.type == "trade")');
alter table form_version enable trigger form_version_published_frozen;

revoke all on function
  app.work_item_answers(uuid),
  app.check_work_item_built_ins(uuid, uuid, uuid, uuid, uuid, uuid[]),
  app.set_work_item_built_ins(uuid, uuid, uuid, uuid, uuid[]),
  app.create_work_item(uuid, text, text, uuid, jsonb, uuid, uuid, timestamptz, uuid[]),
  app.save_work_item_answers(uuid, jsonb, uuid, uuid, uuid[], timestamptz)
  from public;
grant execute on function
  app.work_item_answers(uuid),
  app.create_work_item(uuid, text, text, uuid, jsonb, uuid, uuid, timestamptz, uuid[]),
  app.save_work_item_answers(uuid, jsonb, uuid, uuid, uuid[], timestamptz)
  to rabaed_app;
