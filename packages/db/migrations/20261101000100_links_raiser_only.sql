-- Free Links change only for the raiser (RP-306, spec RP-299).
--
-- A free Link was added or removed by whoever app.can_save_answers allowed: the raiser's
-- Members while its answers are open. RP-304 widened can_save_answers to the Consultant,
-- for its own Form Section; with the MAR Form Version 4 that Consultant could add a free
-- Link to the Contractor's Submitted MAR, which "free Links are changed by nobody but
-- the raiser's Company" (visibility.md) forbids. A free Link isn't in any Form Section,
-- so it stays the raiser's: app.can_change_links is can_save_answers for the raiser's
-- Participant only. add and remove below are the RP-286..RP-294 bodies with that one
-- condition changed; the API's `canChange` asks it too.

create function app.can_change_links(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.can_save_answers(p_work_item_id) and exists (
      select 1 from work_item w
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id and me.participant_id = w.raised_by_participant_id
    )
  $$;

revoke all on function app.can_change_links(uuid) from public;
grant execute on function app.can_change_links(uuid) to rabaed_app;

create or replace function app.add_work_item_link(p_work_item_id uuid, p_target_id uuid, p_now timestamptz)
  returns table (outcome text, link_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_before jsonb;
      v_link uuid;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- Locked, so a Submit waits for the Link, or the Link for the Submit.
      select w.id, w.project_id, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.can_change_links(p_work_item_id) then
        return query select 'not_editable'::text, null::uuid;
        return;
      end if;
      if p_target_id = p_work_item_id or not app.work_item_submitted(p_target_id)
        or not exists (select 1 from work_item t where t.id = p_target_id and t.project_id = v_item.project_id)
      then
        return query select 'target_not_found'::text, null::uuid;
        return;
      end if;
      v_before := app.free_links_record(p_work_item_id);
      insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
      values (v_item.project_id, p_work_item_id, p_target_id, 'related', app.current_member_id(), v_at)
      on conflict on constraint work_item_link_once do nothing
      returning id into v_link;
      if v_link is null then
        return query select 'already_linked'::text, null::uuid;
        return;
      end if;
      perform app.record_free_links_change(p_work_item_id, v_before, v_me.participant_id, v_at);
      return query select 'added'::text, v_link;
    end
  $$;

create or replace function app.remove_work_item_link(p_work_item_id uuid, p_link_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_before jsonb;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, pr.status as project_status into v_item
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
      if not app.can_change_links(p_work_item_id) then
        return 'not_editable';
      end if;
      v_before := app.free_links_record(p_work_item_id);
      delete from work_item_link where id = p_link_id and from_id = p_work_item_id and kind = 'related';
      if not found then
        return 'not_found';
      end if;
      perform app.record_free_links_change(p_work_item_id, v_before, v_me.participant_id, v_at);
      return 'removed';
    end
  $$;
