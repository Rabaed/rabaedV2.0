-- A Revision starts without the Form Sections another Participant filled
-- (RP-305, spec RP-299; form-engine.md §4 "Settled 2026-10-05 (part 3)";
-- visibility.md V19, scenario 49).
--
-- `create_revision` itself (the chain columns, the Document Number's Rev suffix,
-- the Link, copied Documents) is RP-103's. This ticket gives it the part that
-- touches answers:
--
-- * app.revision_dropped_keys: the keys of the fields of the sections filled by a
--   Participant other than the raiser (the section's Steps, `editable_at`, are
--   held by a role other than the Draft Step's), as packages/domain
--   sectionsFilledBy works them out.
-- * app.revision_answers(closed): the closed item's full answers less those
--   fields, the answers a Revision starts with.
-- * app.fill_revision(revision, closed): gives a brand-new Draft Revision of the
--   raiser those answers (Built-in Fields included), with `data_as_arrived`
--   empty and `field_times` rebuilt from them (stamped now, by the raiser), so
--   no stamp or "as arrived" copy of an answer the Revision doesn't have
--   survives. Fields dropped by the Revision's own Form Version (a newer one)
--   are dropped too. The closed item is untouched: closing cleared its
--   `data_as_arrived` (RP-304), so everyone who can see it reads the
--   Consultant's answers there.
-- Outcome of fill_revision: 'filled', 'not_found', or 'not_allowed' (the closed
-- item isn't Code C or failed, isn't the acting Member's Participant's, or the
-- Revision isn't a fresh Draft of the same Participant, Project and Type).

create function app.revision_dropped_keys(p_work_item_id uuid) returns text[]
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select coalesce(array_agg(f ->> 'key'), '{}')
    from work_item w
    join form_version v on v.id = w.form_version_id
    cross join lateral jsonb_array_elements(v.schema -> 'sections') s
    cross join lateral jsonb_array_elements(s -> 'fields') f
    where w.id = p_work_item_id and s ? 'editable_at'
      and (
        select h.actor_rule ->> 'base_role' from workflow_step h
        where h.workflow_version_id = w.workflow_version_id and h.key = s -> 'editable_at' ->> 0
      ) is distinct from (
        select d.actor_rule ->> 'base_role' from workflow_step d
        where d.workflow_version_id = w.workflow_version_id and app.is_draft_step(d.id)
        limit 1)
  $$;

create function app.revision_answers(p_closed_item_id uuid) returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.work_item_full_answers(w.id) - app.revision_dropped_keys(w.id)
    from work_item w where w.id = p_closed_item_id
  $$;

create function app.fill_revision(p_revision_id uuid, p_closed_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
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
      if coalesce(v_closed.outcome, '') not in ('C', 'failed')
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
      v_scopes := array(select x::uuid from jsonb_array_elements_text(coalesce(v_answers -> 'scopes', '[]')) x);
      perform app.set_work_item_built_ins(
        p_revision_id, v_revision.project_id,
        (v_answers ->> 'trade')::uuid, (v_answers ->> 'location')::uuid, v_scopes);
      update work_item set
        data = v_answers - array['trade', 'location', 'scopes'],
        data_as_arrived = null,
        field_times = '{}'::jsonb,
        updated_at = greatest(p_now, now())
      where id = p_revision_id;
      perform app.record_field_times(p_revision_id, p_now);
      return 'filled';
    end
  $$;

revoke all on function
  app.revision_dropped_keys(uuid),
  app.revision_answers(uuid),
  app.fill_revision(uuid, uuid, timestamptz)
  from public;
grant execute on function app.fill_revision(uuid, uuid, timestamptz) to rabaed_app;
