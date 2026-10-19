-- RP-636: an Open Package (spec RP-616; data-model.md package; visibility.md scenario RP-588-1).
--
-- * package: a named group of submittals owned by one Participant, numbered per Project and
--   owning Participant (PKG-001, PKG-002…, never reused: a discarded Package keeps its row and its
--   number). Numbering per owning Participant rather than one count per Project: a shared count's
--   gaps would tell each Company how many Packages the others hold, Open ones included, which
--   RP-588-1 forbids ("no count"); Document Numbers count by Participant Code for the same reason
--   (visibility.md "Document Numbers"). `status` is stored (open, in_progress, done); this ticket
--   leaves it Open, the Submit (RP-638) and the closures (RP-642) recompute it.
-- * work_item.package_id: the item's Package, at most one. Never granted to the app role: K1 sees
--   C1's Submitted items, and reading their package_id would tell it they are in a Package it may
--   not see. The api reads an item's Package through app.work_item_package.
-- * package_event: the Package's own trail (created, renamed, item_added, item_removed, submitted,
--   discarded), append-only and unreadable through the app role until a reader is built.
-- * app.sees_package: a Member of the owning Participant, while the Package is not discarded. RP-641
--   extends it to a Member who sees one of its items; the row is read only through it (RLS).
-- * Writes only through the security definer functions below, each re-checking the caller's
--   access. A Package or item the caller may not see is 'not_found' for the Package, and one answer,
--   'item_not_offered', for an item whatever the reason (not seen, another Participant's, not a
--   submittal, a made-up id), so nothing tells of an item the caller may not see. A Closed Project
--   answers 'project_closed'.

create table package (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  -- The owning Participant.
  participant_id uuid not null,
  -- Shown PKG- and three digits, left-to-right; per Project and owning Participant.
  seq integer not null check (seq > 0),
  name jsonb not null check (app.is_bilingual(name)),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  created_by_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  -- An Open Package deleted (the List's Delete, as app.discard_draft): nobody sees it again; its number is never given again.
  discarded_at timestamptz,
  constraint package_participant_fk foreign key (participant_id, project_id) references participant (id, project_id),
  constraint package_seq_key unique (project_id, participant_id, seq),
  constraint package_id_project_key unique (id, project_id),
  check (discarded_at is null or status = 'open')
);
create index package_participant_id_idx on package (participant_id);
create index package_created_by_member_id_idx on package (created_by_member_id);

alter table work_item add column package_id uuid;
alter table work_item add constraint work_item_package_fk foreign key (package_id, project_id) references package (id, project_id);
create index work_item_package_id_idx on work_item (package_id) where package_id is not null;

create table package_event (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  package_id uuid not null,
  type text not null check (type in ('created', 'renamed', 'item_added', 'item_removed', 'submitted', 'discarded')),
  -- The item added or removed.
  work_item_id uuid references work_item (id),
  actor_member_id uuid not null references member (id),
  actor_participant_id uuid not null references participant (id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint package_event_package_fk foreign key (package_id, project_id) references package (id, project_id),
  check ((type in ('item_added', 'item_removed')) = (work_item_id is not null))
);
create index package_event_package_idx on package_event (package_id, created_at);
create index package_event_work_item_id_idx on package_event (work_item_id) where work_item_id is not null;
create index package_event_actor_member_id_idx on package_event (actor_member_id);
create index package_event_actor_participant_id_idx on package_event (actor_participant_id);

create function app.refuse_package_event_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'package_event is append-only' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_package_event_change() from public;
create trigger package_event_append_only before update or delete on package_event
  for each row execute function app.refuse_package_event_change();
create trigger package_event_no_truncate before truncate on package_event
  for each statement execute function app.refuse_package_event_change();

-- Reads -----------------------------------------------------------------------

-- Whether the acting Member sees Package p_package_id: a Member of its owning Participant, while
-- it is not discarded. An Open Package holds only items its owner has not Submitted, so nobody else
-- sees it (RP-588-1); RP-641 adds the Members who see one of its items.
create function app.sees_package(p_package_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return exists (
        select 1 from package k
        where k.id = p_package_id and k.discarded_at is null
          and k.project_id in (select app.current_project_ids())
          and app.acts_for_participant(k.project_id, k.participant_id)
      );
    end
  $$;

-- The items of Package p_package_id the acting Member sees; none when they don't see the Package.
-- Counts and lists of a Package come from these only, never a total with items they don't see.
create function app.package_items(p_package_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_package(p_package_id) then
        return;
      end if;
      return query
        select w.id from work_item w
        where w.package_id = p_package_id and app.sees_work_item(w.id);
    end
  $$;

-- The Package of item p_work_item_id (its id, number and name), when the acting Member sees both
-- the item and the Package; else no row, so it never tells of a Package they may not see.
create function app.work_item_package(p_work_item_id uuid) returns table (package_id uuid, seq integer, name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_package_id uuid;
    begin
      -- Most items have none: answer at once, before the dearer checks (the work item query asks for every row).
      -- No row either way, so the order tells nothing.
      select w.package_id into v_package_id from work_item w where w.id = p_work_item_id;
      if v_package_id is null or not app.sees_work_item(p_work_item_id) or not app.sees_package(v_package_id) then
        return;
      end if;
      return query select k.id, k.seq, k.name from package k where k.id = v_package_id;
    end
  $$;

alter table package enable row level security;
-- What every Member who sees the Package reads; not who created it or when, nor that it was discarded.
revoke all on package from rabaed_app;
grant select (id, project_id, participant_id, seq, name, status) on package to rabaed_app;
create policy member_reads_seen_packages on package for select to rabaed_app
  using (app.sees_package(id));

alter table package_event enable row level security;
revoke all on package_event from rabaed_app;
revoke update, delete, truncate on package_event from rabaed_admin;

-- Writes -----------------------------------------------------------------------

-- The Package's trail, as the acting Member of its owning Participant. A helper of the writes below.
create function app.write_package_event(p_package_id uuid, p_type text, p_work_item_id uuid, p_payload jsonb, p_at timestamptz)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into package_event (project_id, package_id, type, work_item_id, actor_member_id, actor_participant_id, payload, created_at)
      select k.project_id, k.id, p_type, p_work_item_id, app.current_member_id(), k.participant_id, p_payload, p_at
      from package k where k.id = p_package_id;
    end
  $$;

-- Package p_package_id locked for a write by the acting Member, with its Project's status; no row
-- when they don't see it. A helper of the writes below.
create function app.package_for_write(p_package_id uuid)
  returns table (id uuid, project_id uuid, participant_id uuid, status text, project_status text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_package(p_package_id) then
        return;
      end if;
      return query
        select k.id, k.project_id, k.participant_id, k.status, pr.status
        from package k join project pr on pr.id = k.project_id
        where k.id = p_package_id
        for update of k;
    end
  $$;

-- A Member of a Participant on Project p_project_id creates a Package of their Participant named
-- p_name (English and Arabic). Outcome: 'created' (with the Package and its number), 'not_found'
-- (not a Project of theirs, whether or not it exists), 'project_closed' or 'invalid_name'.
create function app.create_package(p_project_id uuid, p_name jsonb, p_now timestamptz)
  returns table (outcome text, package_id uuid, seq integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_participant_id uuid;
      v_name jsonb := jsonb_build_object('en', btrim(p_name ->> 'en'), 'ar', btrim(p_name ->> 'ar'));
      v_seq integer;
      v_id uuid;
    begin
      select pm.participant_id into v_participant_id
      from project_member pm
      join participant p on p.id = pm.participant_id
      where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
        and p.status = 'active' and p.company_id = app.current_company_id()
        and p_project_id in (select app.current_project_ids());
      if v_participant_id is null then
        return query select 'not_found'::text, null::uuid, null::integer;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status <> 'active') then
        return query select 'project_closed'::text, null::uuid, null::integer;
        return;
      end if;
      if not app.is_bilingual(v_name) then
        return query select 'invalid_name'::text, null::uuid, null::integer;
        return;
      end if;
      -- The next number and the insert, one Participant's Packages at a time.
      perform pg_advisory_xact_lock(hashtextextended('package/' || p_project_id::text || '/' || v_participant_id::text, 0));
      select coalesce(max(k.seq), 0) + 1 into v_seq from package k
      where k.project_id = p_project_id and k.participant_id = v_participant_id;
      insert into package (project_id, participant_id, seq, name, created_by_member_id, created_at)
      values (p_project_id, v_participant_id, v_seq, v_name, app.current_member_id(), v_at)
      returning id into v_id;
      perform app.write_package_event(v_id, 'created', null, jsonb_build_object('name', v_name), v_at);
      return query select 'created'::text, v_id, v_seq;
    end
  $$;

-- A Member of the owning Participant renames Package p_package_id. Outcome: 'renamed' (also when
-- the name is unchanged, with no event), 'not_found', 'project_closed' or 'invalid_name'. Recorded
-- in the Package's trail.
create function app.rename_package(p_package_id uuid, p_name jsonb, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
      v_old jsonb;
      v_name jsonb := jsonb_build_object('en', btrim(p_name ->> 'en'), 'ar', btrim(p_name ->> 'ar'));
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.is_bilingual(v_name) then
        return 'invalid_name';
      end if;
      select name into v_old from package where id = p_package_id;
      if v_old = v_name then
        return 'renamed';
      end if;
      update package set name = v_name where id = p_package_id;
      perform app.write_package_event(p_package_id, 'renamed', null, jsonb_build_object('from', v_old, 'to', v_name), v_at);
      return 'renamed';
    end
  $$;

-- A Member of the owning Participant adds item p_work_item_id to Package p_package_id. Only a
-- submittal (a Type of the Submittals Module) the owning Participant raised and the Member sees;
-- a Draft only when the Member may edit it (the rule for saving its answers). Outcome: 'added'
-- (also when it already is in this Package), 'not_found' (the Package), 'project_closed',
-- 'item_not_offered' (one answer whatever the reason: not seen, another Participant's, not a
-- submittal, discarded, a made-up id), 'in_another_package' or 'not_editable'.
create function app.add_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
      v_item record;
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.sees_work_item(p_work_item_id) then
        return 'item_not_offered';
      end if;
      select w.id, w.package_id, w.document_number into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and w.project_id = v_package.project_id
        and w.raised_by_participant_id = v_package.participant_id
        and t.module_key = 'submittals' and w.discarded_at is null
      for update of w;
      if v_item.id is null then
        return 'item_not_offered';
      end if;
      if v_item.package_id = p_package_id then
        return 'added';
      end if;
      if v_item.package_id is not null then
        return 'in_another_package';
      end if;
      -- A Draft: never sent, no Document Number (GLOSSARY.md Draft).
      if v_item.document_number is null and not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      update work_item set package_id = p_package_id where id = p_work_item_id;
      perform app.write_package_event(p_package_id, 'item_added', p_work_item_id, '{}', v_at);
      return 'added';
    end
  $$;

-- A Member of the owning Participant removes item p_work_item_id from Package p_package_id, while
-- the Package is Open. Outcome: 'removed', 'not_found' (the Package), 'project_closed',
-- 'package_not_open' or 'item_not_in_package' (not in it, or an item the Member doesn't see).
create function app.remove_package_item(p_package_id uuid, p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if v_package.status <> 'open' then
        return 'package_not_open';
      end if;
      if not app.sees_work_item(p_work_item_id)
        or not exists (select 1 from work_item where id = p_work_item_id and package_id = p_package_id) then
        return 'item_not_in_package';
      end if;
      update work_item set package_id = null where id = p_work_item_id;
      perform app.write_package_event(p_package_id, 'item_removed', p_work_item_id, '{}', v_at);
      return 'removed';
    end
  $$;

-- A Member of the owning Participant deletes (discards) Open Package p_package_id: its items stay
-- as they were, without a Package, and nobody sees it again. Outcome: 'discarded', 'not_found',
-- 'project_closed' or 'package_not_open'.
create function app.discard_package(p_package_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_package record;
    begin
      select * into v_package from app.package_for_write(p_package_id);
      if v_package.id is null then
        return 'not_found';
      end if;
      if v_package.project_status <> 'active' then
        return 'project_closed';
      end if;
      if v_package.status <> 'open' then
        return 'package_not_open';
      end if;
      update work_item set package_id = null where package_id = p_package_id;
      update package set discarded_at = v_at where id = p_package_id;
      perform app.write_package_event(p_package_id, 'discarded', null, '{}', v_at);
      return 'discarded';
    end
  $$;

revoke all on function
  app.sees_package(uuid),
  app.package_items(uuid),
  app.work_item_package(uuid),
  app.write_package_event(uuid, text, uuid, jsonb, timestamptz),
  app.package_for_write(uuid),
  app.create_package(uuid, jsonb, timestamptz),
  app.rename_package(uuid, jsonb, timestamptz),
  app.add_package_item(uuid, uuid, timestamptz),
  app.remove_package_item(uuid, uuid, timestamptz),
  app.discard_package(uuid, timestamptz)
  from public;
-- app.write_package_event and app.package_for_write are helpers of the writes (and of RP-638's), not for the app role.
grant execute on function
  app.sees_package(uuid),
  app.package_items(uuid),
  app.work_item_package(uuid),
  app.create_package(uuid, jsonb, timestamptz),
  app.rename_package(uuid, jsonb, timestamptz),
  app.add_package_item(uuid, uuid, timestamptz),
  app.remove_package_item(uuid, uuid, timestamptz),
  app.discard_package(uuid, timestamptz)
  to rabaed_app;
