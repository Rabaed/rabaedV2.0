-- Only Code C opens a Revision (RP-311 review; workflow-engine.md §5.4). The
-- create_revision migration also let an item closed `failed` be revised, for
-- Inspections, whose Revisions are out of this spec's scope. app.can_create_revision
-- and app.fill_revision are as that migration left them, with `C` the only
-- outcome. Create or replace keeps their grants (fill_revision stays revoked from
-- the app role).

-- As in the create_revision migration, for Code C only.
create or replace function app.can_create_revision(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.sees_work_item(p_work_item_id) and exists (
      select 1
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id and pr.status = 'active'
      join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
      join participant p on p.id = me.participant_id
      join project_role r on r.id = p.project_role_id
      join app.latest_draft_step(w.work_item_type_id) d on true
      where w.id = p_work_item_id
        and w.outcome = 'C' and w.discarded_at is null
        and d.actor_rule ->> 'base_role' = r.base_role
        and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
        -- The latest of its chain, and nothing of the chain open.
        and not exists (
          select 1 from work_item o
          where o.root_id = w.root_id and o.discarded_at is null
            and (o.revision_no > w.revision_no or o.closed_at is null))
    )
  $$;

-- As in the create_revision migration, for Code C only.
create or replace function app.fill_revision(p_revision_id uuid, p_closed_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_closed record;
      v_revision record;
      v_answers jsonb;
      v_scopes uuid[];
    begin
      if not app.sees_work_item(p_closed_item_id) or not app.sees_work_item(p_revision_id) then
        return 'not_found';
      end if;
      select * into v_closed from work_item where id = p_closed_item_id;
      select * into v_revision from work_item where id = p_revision_id for update;
      if v_closed.outcome is distinct from 'C'
        or p_revision_id = p_closed_item_id
        or v_closed.raised_by_participant_id not in (select app.current_participant_ids())
        or v_revision.raised_by_participant_id <> v_closed.raised_by_participant_id
        or v_revision.project_id <> v_closed.project_id
        or v_revision.work_item_type_id <> v_closed.work_item_type_id
        or v_revision.closed_at is not null
        or not app.is_draft_step(v_revision.current_step_id)
        or exists (select 1 from work_item_event e where e.work_item_id = p_revision_id and e.type = 'transition')
        or not app.can_save_answers(p_revision_id)
      then
        return 'not_allowed';
      end if;

      v_answers := app.revision_answers(p_closed_item_id) - app.revision_dropped_keys(p_revision_id);
      -- RP-316: only the answers the Revision's Form Version still has, with the same
      -- type; the Built-in Fields are in every Form.
      v_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(v_answers) a
        where a.key in ('trade', 'location', 'scopes')
          or app.form_field_type(v_revision.form_version_id, a.key) = app.form_field_type(v_closed.form_version_id, a.key)
      ), '{}'::jsonb);
      v_scopes := array(select x::uuid from jsonb_array_elements_text(coalesce(v_answers -> 'scopes', '[]')) x);
      perform app.set_work_item_built_ins(
        p_revision_id, v_revision.project_id,
        (v_answers ->> 'trade')::uuid, (v_answers ->> 'location')::uuid, v_scopes);
      update work_item set
        data = v_answers - array['trade', 'location', 'scopes'],
        data_as_arrived = null,
        field_times = '{}'::jsonb,
        field_times_as_arrived = null,
        updated_at = v_at
      where id = p_revision_id;
      perform app.sync_link_answers(
        p_revision_id, v_revision.project_id, v_revision.form_version_id, v_answers - array['trade', 'location', 'scopes'], v_at);
      perform app.record_field_times(p_revision_id, p_now);
      return 'filled';
    end
  $$;
