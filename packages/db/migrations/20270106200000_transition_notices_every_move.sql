-- Review fix of spec RP-423 (RP-432, WF-9; workflow-engine.md §8; visibility.md the
-- Notifications row): a Transition's own recipients hear of every move it makes.
--
-- 20270101000000_transition_notifications.sql read a Transition's recipients only for
-- events of type `transition`, but a close from a Step that issues a Code writes
-- `issue_code` (app.transition_effects), so "Code issued" never reached them. Every
-- event a Transition writes for its move (`transition`: a send, a Submit, a Return, a
-- Send Back, a Cancel, a close; `issue_code`: a Code) now carries that Transition's
-- recipients. Each is still re-checked at send time, as that Member
-- (app.notify_member), unchanged.

-- As in 20270101000000_transition_notifications.sql, for every move a Transition makes.
create or replace function app.transition_notice_members(p_work_item_event_id uuid) returns table (member_id uuid)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select w.created_by_member_id
        from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        join work_item w on w.id = e.work_item_id
        where e.id = p_work_item_event_id and e.type in ('transition', 'issue_code')
          and tr.notifications @> '[{"to": "raiser"}]'
        union
        select pm.member_id
        from work_item_event e
        join workflow_transition tr on tr.id = e.transition_id
        cross join lateral jsonb_array_elements(tr.notifications) n
        join participant pa on pa.id = e.actor_participant_id
        join project_role pr on pr.id = pa.project_role_id
        join position po on po.base_role = pr.base_role and po.key = n ->> 'position'
        join project_member pm on pm.participant_id = pa.id and pm.status = 'active'
        join project_member_position mp on mp.project_member_id = pm.id and mp.position_id = po.id
        join member m on m.id = pm.member_id and m.status = 'active'
        where e.id = p_work_item_event_id and e.type in ('transition', 'issue_code')
          and jsonb_typeof(tr.notifications) = 'array' and n ->> 'to' = 'position';
    end
  $$;

-- As in 20270101000000_transition_notifications.sql: a move of a Transition naming the
-- raiser or a Position goes out whatever its event type (the trigger fires for
-- `transition`, `issue_code` and `cancelled`; only the first two carry a Transition).
create or replace function app.outbox_watched_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
          select 1 from work_item_watch ww join work_item w on w.root_id = ww.root_id
          where w.id = new.work_item_id and ww.member_id is distinct from new.actor_member_id
        )
        or (
          new.type in ('transition', 'issue_code') and exists (
            select 1 from workflow_transition tr
            where tr.id = new.transition_id and tr.notifications is not null
              and jsonb_path_exists(tr.notifications, '$[*] ? (@.to == "raiser" || @.to == "position")')
          )
        )
      then
        insert into outbox (kind, project_id, payload, created_at, available_at)
        values ('notification', new.project_id,
          jsonb_strip_nulls(jsonb_build_object('work_item_id', new.work_item_id, 'work_item_event_id', new.id,
            'actor_member_id', new.actor_member_id)),
          new.created_at, now());
      end if;
      return null;
    end
  $$;
