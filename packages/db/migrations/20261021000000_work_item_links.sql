-- Links between Work Items (RP-291, spec RP-289; form-engine.md part 2b;
-- data-model.md work_item_link; visibility.md E1, the Links row, scenarios 11,
-- 12 and 30).
--
-- * work_item_link: one row per Link, from one item to another in the same
--   Project. `kind` is `related` (a free Link, added in the Links System Field),
--   `relies_on` (an item chosen in a link question, `field_key` naming that
--   `work_item_ref` field; RP-293) or `raised_from` (the Snag List, later).
--   One row per (from, to, field key), so a free Link and a link question may
--   both point at the same target, never twice the same way. Never to itself.
-- * Read under the _from_ item's row-level security, keyed by Project: a Link
--   returns only to a Member who sees the item it is on. The app role reads
--   neither `to_id` nor `created_by_member_id`: a target the reader can't see
--   must not reach them even by id (E1), and the linker is another Company's
--   person to most readers (V14). Targets are read through app.work_item_links,
--   and "Linked from" (RP-292) goes through its own function, never the table.
-- * Written only by app.* functions, never by the app role directly. A Link
--   changes while the raiser's Company may still save the answers
--   (app.can_save_answers: Draft and its internal Steps, until Submit); then it
--   is frozen with them. The target must be one Link search could have offered
--   (app.work_item_submitted: visible to the caller, Submitted), in the same
--   Project; anything else, a made-up id included, is refused alike
--   (`target_not_found`). The item itself is never Submitted while its Links can
--   change, so a Link to itself is refused the same way.
-- * Free Links (app.add_work_item_link, app.remove_work_item_link): after Draft,
--   each change is on the record like an answer change (RP-268): one internal
--   'answers_changed' event whose change is the Links System Field, `$links`
--   (no Form field key can start with `$`), its old and new free Links as
--   Document Number and Subject, never an id. Nobody is notified.

create table work_item_link (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  from_id uuid not null,
  to_id uuid not null,
  kind text not null check (kind in ('related', 'relies_on', 'raised_from')),
  field_key text,
  created_by_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  constraint work_item_link_from_fk foreign key (from_id, project_id) references work_item (id, project_id),
  constraint work_item_link_to_fk foreign key (to_id, project_id) references work_item (id, project_id),
  constraint work_item_link_not_itself check (from_id <> to_id),
  constraint work_item_link_field_key check ((kind = 'relies_on') = (field_key is not null)),
  constraint work_item_link_once unique nulls not distinct (from_id, to_id, field_key)
);
create index work_item_link_to_id_idx on work_item_link (to_id);

alter table work_item_link enable row level security;
revoke all on work_item_link from rabaed_app;
grant select (id, project_id, from_id, kind, field_key, created_at) on work_item_link to rabaed_app;

-- On an item the Member sees (the subquery is itself filtered), in one of their Projects.
create policy member_reads_work_item_links on work_item_link for select to rabaed_app
  using (project_id in (select app.current_project_ids()) and from_id in (select id from work_item));

-- Reading ----------------------------------------------------------------------------

-- A visible item's Links, oldest first: each with its kind and field key, and the
-- target's Document Number and Subject (E1). The target's id only when the
-- acting Member sees it, so a hidden one can't be asked for. Nothing for an item
-- they can't see.
create function app.work_item_links(p_work_item_id uuid)
  returns table (
    id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select l.id, l.kind, l.field_key, t.document_number, t.title,
      case when app.sees_work_item(t.id) then t.id end, l.created_at
    from work_item_link l
    join work_item t on t.id = l.to_id
    where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
    order by l.created_at, l.id
  $$;

revoke all on function app.work_item_links(uuid) from public;
grant execute on function app.work_item_links(uuid) to rabaed_app;

-- Writing free Links -----------------------------------------------------------------

-- A visible item's free Links as its history records them: Document Number and
-- Subject, oldest first, never an id. Only the functions below call it.
create function app.free_links_record(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(
      jsonb_build_object('documentNumber', t.document_number, 'subject', t.title) order by l.created_at, l.id), '[]')
    from work_item_link l
    join work_item t on t.id = l.to_id
    where l.from_id = p_work_item_id and l.kind = 'related'
  $$;

-- Once the item has left Draft (a Draft it was Returned to included), a change
-- to its free Links is on the record like an answer change (as
-- app.save_work_item_answers): one 'answers_changed' event, internal to the
-- raiser's Participant (V5), in the hash chain. Only the functions below call it.
create function app.record_free_links_change(
  p_work_item_id uuid, p_before jsonb, p_participant_id uuid, p_at timestamptz
) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_after jsonb := app.free_links_record(p_work_item_id);
    begin
      if v_after is not distinct from p_before or not exists (
        select 1 from work_item_event e
        where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
      ) then
        return;
      end if;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, payload,
        audience, audience_participant_id, content_sha256, created_at
      )
      select w.project_id, w.id, 'answers_changed', app.current_member_id(), p_participant_id,
        jsonb_build_object('changes', jsonb_build_array(jsonb_build_object('field', '$links', 'old', p_before, 'new', v_after))),
        'internal', w.raised_by_participant_id, sha256(convert_to(v_after::text, 'UTF8')), p_at
      from work_item w where w.id = p_work_item_id;
    end
  $$;

-- The acting Member adds a free Link from a visible item to `p_target_id`.
-- Outcomes: 'added' (with the Link's id), 'not_found' (the item), 'project_closed',
-- 'not_editable' (not the raiser's Company, or Submitted), 'target_not_found'
-- (anything Link search couldn't have offered them: hidden, Draft, internal,
-- another Project's, made up, the item itself), 'already_linked'. The target is
-- checked before duplicates, so a refusal never tells a hidden id from another.
create function app.add_work_item_link(p_work_item_id uuid, p_target_id uuid, p_now timestamptz)
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
      if not app.can_save_answers(p_work_item_id) then
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

-- The acting Member removes a free Link from a visible item. Outcomes: 'removed',
-- 'not_found' (the item, or no such free Link on it), 'project_closed',
-- 'not_editable'. A link question's Links change with its answer, not here.
create function app.remove_work_item_link(p_work_item_id uuid, p_link_id uuid, p_now timestamptz) returns text
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
      if not app.can_save_answers(p_work_item_id) then
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

revoke all on function
  app.free_links_record(uuid),
  app.record_free_links_change(uuid, jsonb, uuid, timestamptz),
  app.add_work_item_link(uuid, uuid, timestamptz),
  app.remove_work_item_link(uuid, uuid, timestamptz)
  from public;
grant execute on function
  app.add_work_item_link(uuid, uuid, timestamptz),
  app.remove_work_item_link(uuid, uuid, timestamptz)
  to rabaed_app;
