-- An item Sent Back to its raiser stays with everyone who saw it, as it was at
-- the Send Back (RP-309; ADR 0013, ADR 0014; visibility.md V1, V19, the Links,
-- Linked from, Link search and File downloads channels, scenarios 58, 59 and 60;
-- data-model.md work_item, document, work_item_link).
--
-- * V1 (app.sees_work_item): an item that has been Submitted (it has a
--   submitted_at) stays visible to the Participants with access to it, also
--   while it is back at its raiser's own Steps after a Send Back. Before, an item
--   at a Step of the raiser's base role was the raiser's only, so K1, the Owner
--   and the Owner Representative lost it until it was Submitted again. An item
--   that has never left its raiser is still the raiser's only.
-- * "Submitted" in Link search and Links (app.work_item_submitted) and Linked
--   from (app.work_item_linked_from) means Submitted at least once:
--   `submitted_at is not null` (RP-295). A Sent Back item stays offered and listed.
-- * As it was at the Send Back (V19): the Documents (the Attachments System
--   Field, file-field uploads, photos and checklist photos) and the Links (free
--   and `relies_on`) a Participant adds or removes while it holds the item reach
--   only its Members until the item leaves it (a Submit, a Code, a close);
--   everyone else goes on seeing them as they were when it arrived. Only the
--   raiser can change these (in Draft and its internal Steps), so this is what
--   keeps a Sent Back item's in-progress changes inside its raiser. The answers
--   (checklist items, link questions) already follow it through
--   work_item.data_as_arrived (RP-304).
--   - work_item.arrivals counts the times the item has arrived at a Participant
--     or closed: the share_answers_on_leaving trigger adds one exactly when it
--     clears data_as_arrived. Never granted to the app role.
--   - document.arrival and work_item_link.arrival: the item's `arrivals` when
--     the row was added (a trigger sets it). A row added during the current
--     arrival is the holder's until the item leaves; then it is everyone's, with
--     nothing to update. On the document table, which the app role reads whole,
--     it tells nothing new: every arrival is a shared Transition in the history.
--   - work_item_link.removed_at: a Link removed during the current arrival that
--     others still see; the holder doesn't. When the item leaves, those rows go.
--     A Link added and removed in the same arrival is deleted at once, as before.
--     Not granted to the app role.
--   - A Document others have seen is frozen (it left Draft), so it is never
--     removed; only one added during the current arrival can be, and nobody
--     else ever saw it.
--   - app.item_row_seen(item, arrival, removed) is the one rule: the RLS
--     policies on document and work_item_link, app.work_item_links and
--     app.work_item_linked_from all apply it, so the api, a direct read of the
--     tables and Linked from agree.
-- * Notifications and the Activity Feed: nothing new. Changes to Documents write
--   no event, and changes to Links and answers write `answers_changed` events
--   internal to the Participant making them (V5, V19); a Transition inside the
--   raiser notifies only the raiser's Members.
-- * The Transition event's content hash is unchanged: the title and the answers.
-- * Backfill: an item that has been Submitted or closed counts one arrival, so
--   its existing rows are shared; an item that has never left its raiser keeps
--   0, and its rows stay its raiser's.

-- How many times the item has arrived somewhere -----------------------------------

alter table work_item add column arrivals integer not null default 0 check (arrivals >= 0);
update work_item set arrivals = 1 where submitted_at is not null or closed_at is not null;

alter table document add column arrival integer not null default 0;
alter table work_item_link
  add column arrival integer not null default 0,
  add column removed_at timestamptz;

-- As in the consultant_section migration, and one more arrival each time.
create or replace function app.share_answers_on_leaving() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      if new.participant_entered_at is distinct from old.participant_entered_at
        or new.participant_entered_step_id is distinct from old.participant_entered_step_id
        or (new.closed_at is not null and old.closed_at is null)
      then
        new.data_as_arrived := null;
        new.arrivals := old.arrivals + 1;
      end if;
      return new;
    end
  $$;

-- When the item leaves, the Links removed while it was held go for everyone.
create function app.drop_removed_links_on_leaving() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      delete from work_item_link where from_id = new.id and removed_at is not null;
      return null;
    end
  $$;
create trigger work_item_drops_removed_links after update on work_item
  for each row when (old.arrivals is distinct from new.arrivals)
  execute function app.drop_removed_links_on_leaving();

-- A new Document or Link belongs to the item's current arrival. (Each branch
-- names a column of its own table only: plpgsql plans a branch when it runs.)
create function app.stamp_arrival() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if tg_table_name = 'document' then
        new.arrival := (select w.arrivals from work_item w where w.id = new.work_item_id);
      else
        new.arrival := (select w.arrivals from work_item w where w.id = new.from_id);
      end if;
      return new;
    end
  $$;
create trigger document_stamps_arrival before insert on document
  for each row execute function app.stamp_arrival();
create trigger work_item_link_stamps_arrival before insert on work_item_link
  for each row execute function app.stamp_arrival();

-- The one rule ----------------------------------------------------------------------

-- Whether the acting Member reads a Document or Link of the item, added during
-- `p_arrival` and, for a Link, removed since or not: the Participant holding the
-- item reads it as it is now (nothing removed); everyone else reads the rows the
-- item had when it arrived there (a removed one included, an added one not), and
-- all of a closed item's.
create function app.item_row_seen(p_work_item_id uuid, p_arrival integer, p_removed boolean) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if app.holds_work_item(p_work_item_id) then
        return not p_removed;
      end if;
      return exists (
        select 1 from work_item w
        where w.id = p_work_item_id and (p_arrival < w.arrivals or w.closed_at is not null)
      );
    end
  $$;

alter policy member_reads_documents on document
  using (
    confirmed_at is not null and removed_at is null
    and project_id in (select app.current_project_ids())
    and work_item_id in (select id from work_item)
    and app.item_row_seen(work_item_id, arrival, false)
  );

alter policy member_reads_work_item_links on work_item_link
  using (
    project_id in (select app.current_project_ids()) and from_id in (select id from work_item)
    and app.item_row_seen(from_id, arrival, removed_at is not null)
  );

-- V1 and Submitted at least once ------------------------------------------------------

-- As in the plpgsql_definer_helpers migration, and a Submitted item stays
-- visible also at its raiser's Steps (after a Send Back).
create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          where w.id = p_work_item_id
            and w.project_id in (select app.current_project_ids())
            and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id()
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or s.actor_rule ->> 'base_role' is distinct from raiser_role.base_role)
            and not exists (
              select 1 from work_item_dimension_value dv
              where dv.work_item_id = w.id
                and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
            )
        )
      );
    end
  $$;

-- Visible to the acting Member and Submitted at least once (RP-295).
create or replace function app.work_item_submitted(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1 from work_item w where w.id = p_work_item_id and w.submitted_at is not null
        )
      );
    end
  $$;

-- Reading Links ------------------------------------------------------------------------

-- As in the plpgsql_definer_helpers migration, through app.item_row_seen.
create or replace function app.work_item_links(p_work_item_id uuid)
  returns table(id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title,
          case when app.sees_work_item(t.id) then t.id end, l.created_at
        from work_item_link l
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
          and app.item_row_seen(l.from_id, l.arrival, l.removed_at is not null)
          and not app.chain_item_hidden(p_work_item_id, t.id)
        order by l.created_at, l.id;
    end
  $$;

-- As in the plpgsql_definer_helpers migration: items Submitted at least once,
-- each through its Links as the acting Member reads them (app.item_row_seen).
create or replace function app.work_item_linked_from(p_work_item_id uuid)
  returns table(document_number text, subject text, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select f.document_number, f.title, case when app.sees_work_item(f.id) then f.id end
        from work_item f
        where f.id in (
            select l.from_id from work_item_link l
            where l.to_id = p_work_item_id and app.item_row_seen(l.from_id, l.arrival, l.removed_at is not null))
          and f.submitted_at is not null
          and f.discarded_at is null
          and app.sees_work_item(p_work_item_id)
          and not app.chain_item_hidden(p_work_item_id, f.id)
        order by f.document_number, f.id;
    end
  $$;

-- The free Links as the raiser has them now, for its own history (as in the
-- work_item_links migration, without a removed one).
create or replace function app.free_links_record(p_work_item_id uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select coalesce(jsonb_agg(
      jsonb_build_object('documentNumber', t.document_number, 'subject', t.title) order by l.created_at, l.id), '[]')
    from work_item_link l
    join work_item t on t.id = l.to_id
    where l.from_id = p_work_item_id and l.kind = 'related' and l.removed_at is null
  $$;

-- Writing Links --------------------------------------------------------------------------

-- Takes Link `p_link_id` away from item `p_work_item_id` for its holder: deleted
-- when it was added during the item's current arrival (nobody else saw it),
-- otherwise marked, so others see it until the item leaves.
create function app.take_away_link(p_work_item_id uuid, p_link_id uuid, p_at timestamptz) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    begin
      delete from work_item_link l
      using work_item w
      where l.id = p_link_id and l.from_id = p_work_item_id and w.id = l.from_id and l.arrival >= w.arrivals
        and w.closed_at is null;
      update work_item_link set removed_at = p_at where id = p_link_id and from_id = p_work_item_id and removed_at is null;
    end
  $$;

-- As in the links_raiser_only migration, except that a Link removed during this
-- arrival comes back instead of a new one being added.
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
      update work_item_link set removed_at = null
      where from_id = p_work_item_id and to_id = p_target_id and field_key is null and removed_at is not null
      returning id into v_link;
      if v_link is null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, p_work_item_id, p_target_id, 'related', app.current_member_id(), v_at)
        on conflict on constraint work_item_link_once do nothing
        returning id into v_link;
      end if;
      if v_link is null then
        return query select 'already_linked'::text, null::uuid;
        return;
      end if;
      perform app.record_free_links_change(p_work_item_id, v_before, v_me.participant_id, v_at);
      return query select 'added'::text, v_link;
    end
  $$;

-- As in the links_raiser_only migration, through app.take_away_link.
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
      if not exists (
        select 1 from work_item_link
        where id = p_link_id and from_id = p_work_item_id and kind = 'related' and removed_at is null
      ) then
        return 'not_found';
      end if;
      v_before := app.free_links_record(p_work_item_id);
      perform app.take_away_link(p_work_item_id, p_link_id, v_at);
      perform app.record_free_links_change(p_work_item_id, v_before, v_me.participant_id, v_at);
      return 'removed';
    end
  $$;

-- As in the link_question migration: a `relies_on` Link no longer answered is
-- taken away (app.take_away_link), and one answered again comes back.
create or replace function app.sync_link_answers(
  p_work_item_id uuid, p_project_id uuid, p_form_version_id uuid, p_data jsonb, p_at timestamptz
) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_link uuid;
    begin
      for v_link in
        select l.id from work_item_link l
        where l.from_id = p_work_item_id and l.kind = 'relies_on' and l.removed_at is null and not exists (
          select 1 from app.link_answer_choices(p_form_version_id, p_data) c
          where c.field_key = l.field_key and c.to_id = l.to_id)
      loop
        perform app.take_away_link(p_work_item_id, v_link, p_at);
      end loop;
      update work_item_link l set removed_at = null
      where l.from_id = p_work_item_id and l.kind = 'relies_on' and l.removed_at is not null and exists (
        select 1 from app.link_answer_choices(p_form_version_id, p_data) c
        where c.field_key = l.field_key and c.to_id = l.to_id);
      insert into work_item_link (project_id, from_id, to_id, kind, field_key, created_by_member_id, created_at)
      select p_project_id, p_work_item_id, c.to_id, 'relies_on', c.field_key, app.current_member_id(), p_at
      from app.link_answer_choices(p_form_version_id, p_data) c
      where not exists (
        select 1 from work_item_link l
        where l.from_id = p_work_item_id and l.kind = 'relies_on' and l.field_key = c.field_key and l.to_id = c.to_id)
      order by c.field_key, c.n;
    end
  $$;

revoke all on function
  app.drop_removed_links_on_leaving(),
  app.stamp_arrival(),
  app.item_row_seen(uuid, integer, boolean),
  app.take_away_link(uuid, uuid, timestamptz)
  from public;
-- The RLS policies on document and work_item_link call it as the app role.
grant execute on function app.item_row_seen(uuid, integer, boolean) to rabaed_app;
