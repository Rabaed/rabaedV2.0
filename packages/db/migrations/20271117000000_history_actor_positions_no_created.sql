-- RP-1054 (review fixes of RP-1091; visibility.md V5, the "Work Item history" row; scenarios RP-1091-1
-- to RP-1091-3): app.history_actor_positions gives no `created` event, as the events policy.
--
-- The definer is the app role's to call, so called directly it gave the `created` event's id: a
-- uuid_v7 carrying the Draft's start, which the events policy reads to nobody (send_back,
-- reads_at_scale) and app.work_item_creation_date hides while the item has no number.
--
-- Rebuilt from its latest body: app.history_actor_positions (20271110000000_history_actor_positions.sql).

create or replace function app.history_actor_positions(p_work_item_id uuid) returns table (event_id uuid, positions jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_own uuid[];
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      v_own := array(select app.current_participant_ids());
      return query
        select e.id, coalesce(s.positions, (
            select jsonb_agg(po.name order by po.sort, po.id)
            from project_member pm
            join project_member_position pmp on pmp.project_member_id = pm.id
            join position po on po.id = pmp.position_id
            where pm.participant_id = e.actor_participant_id and pm.member_id = e.actor_member_id
          ), '[]'::jsonb)
        from work_item_event e
        left join work_item_event_signer s on s.event_id = e.id
        where e.work_item_id = p_work_item_id
          and e.actor_member_id is not null
          and e.actor_participant_id = any (v_own)
          -- As the events policy: never the `created` event (the Draft's start), and a shared event or
          -- one internal to the reader's own Participant (V5).
          and e.type <> 'created'
          and (e.audience = 'shared' or e.audience_participant_id = any (v_own));
    end
  $$;
revoke all on function app.history_actor_positions(uuid) from public;
grant execute on function app.history_actor_positions(uuid) to rabaed_app;
