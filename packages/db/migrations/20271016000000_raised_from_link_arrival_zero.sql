-- RP-1031 (found by RP-1002; visibility.md V19, E1, scenario RP-94-1): a follow-up item's `raised_from`
-- Link is read by everyone who sees the item, not only by the Participant holding it.
--
-- * app.raise_follow_up_item (20270922000000_snags_from_failed_check_items.sql) raises a Code B's
--   Comment, or a failed check item's Snag, already shared (`arrivals` 1), then links it `raised_from`
--   to its source. The work_item_link_stamps_arrival trigger stamped that Link with the item's current
--   arrival (1), and app.item_row_as_arrived gives a row of the current arrival to its holder only. So
--   the source's raiser (holding it) read the Link, and the Consultant who raised the item, and every
--   informed or oversight Participant, did not: the Snag List's "Raised from" column and filter showed
--   them nothing. It hid too much; it never leaked.
-- * The Link comes with the item, before its first arrival, as the Snag's "before" photos do (arrival
--   0, same function), so it is now set to arrival 0 after its insert (the trigger overwrites a value
--   given on insert). Everyone who sees the item reads it, by the source's Document Number and
--   Subject, as any shared Link (app.work_item_links); the item's access is the source's, so they are
--   the Participants the source already reaches. Otherwise the function is unchanged.
-- * Backfill: every `raised_from` Link was written this way (no other path writes one, and nobody adds
--   one by hand), at its item's creation; each still stamped with an arrival is set to 0.

create or replace function app.raise_follow_up_item(
  p_source_id uuid, p_type_id uuid, p_route record, p_form_version_id uuid, p_participant_id uuid, p_member_id uuid,
  p_subject text, p_data jsonb, p_at timestamptz, p_checklist_key text default null, p_item_key text default null
) returns uuid
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_source record;
      v_id uuid;
      v_number text;
    begin
      select w.project_id, w.raised_by_participant_id into strict v_source from work_item w where w.id = p_source_id;
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        submitted_at, arrivals, created_at, updated_at
      ) values (
        v_source.project_id, p_type_id, p_participant_id, p_member_id,
        p_subject,
        p_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(p_data) k),
        p_route.workflow_version_id, p_form_version_id, p_route.step_id, p_route.stage_key, p_at,
        -- It has left its raiser: shared from the start, like an item Submitted (V1).
        p_at, 1, p_at, p_at
      ) returning id into v_id;
      -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select v_id, v.project_id, v.dimension_id, v.dimension_value_id
      from work_item_dimension_value v where v.work_item_id = p_source_id;
      insert into work_item_scope (work_item_id, project_id, scope_id)
      select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_source_id;

      v_number := app.issue_document_number(v_id, p_at);
      update work_item set document_number = v_number, numbered_at = p_at where id = v_id;

      -- Visible exactly where the source is (V2): the raiser, the source's raiser
      -- holding it, and every other Participant the source has, for the same reason.
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
        (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      select v_id, a.project_id, a.participant_id, p_at, a.reason
      from work_item_access a where a.work_item_id = p_source_id
      on conflict do nothing;

      -- Held by the source's raiser's Step Pool, from which a Member picks it up.
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
      values (v_source.project_id, v_id, p_route.step_id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_source.project_id, v_id, 'created', p_member_id, p_participant_id, p_route.step_id,
        jsonb_build_object('title', p_subject),
        'internal', p_participant_id, p_at
      );
      -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, content_sha256, created_at
      ) select
        v_source.project_id, v_id, 'transition', p_member_id, p_participant_id, p_route.transition_id,
        tr.from_step_id, p_route.step_id, jsonb_build_object('document_number', v_number), 'shared',
        app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
      from workflow_transition tr, work_item w
      where tr.id = p_route.transition_id and w.id = v_id;

      insert into work_item_link (project_id, from_id, to_id, kind, checklist_key, item_key, created_by_member_id, created_at)
      values (v_source.project_id, v_id, p_source_id, 'raised_from', p_checklist_key, p_item_key, p_member_id, p_at);
      -- It came with the item, before its first arrival (the insert stamped the current one), so
      -- whoever sees the item reads it, as the Snag's "before" photos (RP-1031).
      update work_item_link set arrival = 0 where from_id = v_id and kind = 'raised_from';

      -- Rule 4 (§3.3): a pool of one holds it at once, after the events that raised it.
      perform app.hold_pool_of_one(a.id) from step_assignment a where a.work_item_id = v_id and a.status = 'pooled';
      return v_id;
    end
  $$;

revoke all on function app.raise_follow_up_item(uuid, uuid, record, uuid, uuid, uuid, text, jsonb, timestamptz, text, text) from public;

-- The `raised_from` Links already written, each at its item's creation.
update work_item_link l set arrival = 0
from work_item w
where w.id = l.from_id and l.kind = 'raised_from' and l.arrival > 0 and l.created_at = w.created_at;
