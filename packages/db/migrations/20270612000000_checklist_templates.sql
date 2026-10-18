-- RP-651 (INSP-3, spec RP-649): a Project's Checklist Templates, and the copy a Work Item's
-- `checklist_template` field makes of the one it picks (form-engine.md §3.2, data-model.md
-- "Checklist Templates", visibility.md V20 and scenario RP-651-1).
--
-- * A Checklist Template is a Project's official set of check items, such as "Concrete pour",
--   for one of its Trades. A Project Admin creates it (Version 1), edits it (each edit is the
--   next Version, never a change to one) and retires it (offered to no new pick). Versions are
--   never changed or deleted. Each command is audited in `setup_event` (kind `checklist_template`).
-- * Every Project Member of every Participant reads the Project's templates and their Versions
--   (like the Approved Supplier List, V10, and the Workflows, V20): the official checklists, not
--   anyone's work. The app role reads the content only, never who wrote or retired one, nor when
--   (another Company's people, V14).
-- * A Work Item's `checklist_template` answer is the id of the Version picked. The API checks a
--   new pick is the latest Version of an active template of the item's Trade; then
--   app.sync_work_item_checklists, in the same transaction as the save, copies that Version's
--   name and items onto the item (`work_item_checklist`), the definition of its checklist. A later
--   edit or retirement of the template never changes the copy. A change of the pick before the
--   item's first Submit replaces the copy; after it, the pick and the copy are fixed.
-- * Whoever sees the item reads its copy (the RLS of `work_item` decides); nobody else does.
-- * Anyone but the Project's Project Admins who tries to change a template gets 'not_found',
--   exactly like a made-up id (404, never 403). rabaed_app writes only through the SECURITY
--   DEFINER functions below, and a Closed Project answers 'project_closed'.

-- Audit: a kind of its own in setup_event ------------------------------------------------

alter table setup_event drop constraint setup_event_kind_check;
alter table setup_event add constraint setup_event_kind_check
  check (kind in ('workflow', 'form', 'screen', 'stage', 'outcome_set', 'company_default', 'checklist_template'));
alter table setup_event drop constraint setup_event_check1;
alter table setup_event add constraint setup_event_type_check check (
  (kind = 'workflow' and type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound'))
  or (kind = 'screen' and type in ('screen_created', 'screen_draft_saved', 'screen_published'))
  or (kind = 'stage' and type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed'))
  or (kind = 'outcome_set' and type in ('outcome_added', 'outcome_changed', 'outcomes_reordered'))
  or (kind = 'company_default' and type in ('default_set', 'default_cleared', 'defaults_applied'))
  or (kind = 'checklist_template' and type in ('checklist_template_created', 'checklist_template_edited', 'checklist_template_retired'))
);

create or replace function app.setup_event_kind(p_type text) returns text
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select case
      when p_type in ('duplicated', 'draft_saved', 'published', 'bound', 'unbound') then 'workflow'
      when p_type like 'screen\_%' then 'screen'
      when p_type like 'stage%' then 'stage'
      when p_type like 'outcome%' then 'outcome_set'
      when p_type in ('default_set', 'default_cleared', 'defaults_applied') then 'company_default'
      when p_type like 'checklist\_template\_%' then 'checklist_template'
    end
  $$;
revoke all on function app.setup_event_kind(text) from public;

-- Templates and their Versions -----------------------------------------------------------

create table checklist_template (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project (id),
  -- Its latest Version: the one a new pick copies.
  version_no integer not null default 1 check (version_no > 0),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  retired_by_member_id uuid references member (id),
  retired_at timestamptz,
  unique (id, project_id),
  check ((status = 'retired') = (retired_at is not null)),
  check ((retired_at is null) = (retired_by_member_id is null))
);
create index checklist_template_project_id_idx on checklist_template (project_id);
create index checklist_template_created_by_member_id_idx on checklist_template (created_by_member_id);
create index checklist_template_retired_by_member_id_idx on checklist_template (retired_by_member_id);

create table checklist_template_version (
  id uuid primary key default gen_random_uuid(),
  checklist_template_id uuid not null,
  project_id uuid not null,
  version_no integer not null check (version_no > 0),
  name jsonb not null check (app.is_bilingual(name)),
  -- A Trade of the Project (the commands check it is a Trade, not a Location).
  trade_value_id uuid not null,
  -- 1 to 100 check items, in the shape packages/domain checks (checklistTemplateItems).
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  created_by_member_id uuid not null references member (id),
  created_at timestamptz not null default now(),
  unique (checklist_template_id, version_no),
  constraint checklist_template_version_template_fk foreign key (checklist_template_id, project_id) references checklist_template (id, project_id),
  constraint checklist_template_version_trade_fk foreign key (trade_value_id, project_id) references dimension_value (id, project_id)
);
create index checklist_template_version_project_id_idx on checklist_template_version (project_id);
create index checklist_template_version_trade_value_id_idx on checklist_template_version (trade_value_id);
create index checklist_template_version_created_by_member_id_idx on checklist_template_version (created_by_member_id);

-- The latest Version is one of its own; written in the same transaction as the template.
alter table checklist_template add constraint checklist_template_latest_version_fk
  foreign key (id, version_no) references checklist_template_version (checklist_template_id, version_no)
  deferrable initially deferred;

-- A Version is never changed or deleted: the items that copied it say which it was.
create function app.refuse_checklist_template_version_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'checklist_template_version is append-only' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_checklist_template_version_change() from public;
create trigger checklist_template_version_append_only before update or delete on checklist_template_version
  for each row execute function app.refuse_checklist_template_version_change();

-- The copy a Work Item holds ---------------------------------------------------------------

create table work_item_checklist (
  work_item_id uuid not null references work_item (id),
  -- The `checklist_template` field that picked it.
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) <= 64),
  checklist_template_version_id uuid not null references checklist_template_version (id),
  -- Copied from that Version, so the item's checklist is its own.
  name jsonb not null check (app.is_bilingual(name)),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  -- When it was copied: audit only, never granted (a Draft's times are shown to nobody).
  copied_at timestamptz not null default now(),
  primary key (work_item_id, field_key)
);
create index work_item_checklist_version_id_idx on work_item_checklist (checklist_template_version_id);

-- Access for rabaed_app ----------------------------------------------------------------------

alter table checklist_template enable row level security;
alter table checklist_template_version enable row level security;
alter table work_item_checklist enable row level security;
revoke all on checklist_template, checklist_template_version, work_item_checklist from rabaed_app;
-- Column by column: the content every Project Member reads, never who wrote it or when.
grant select (id, project_id, version_no, status) on checklist_template to rabaed_app;
grant select (id, checklist_template_id, project_id, version_no, name, trade_value_id, items) on checklist_template_version to rabaed_app;
grant select (work_item_id, field_key, checklist_template_version_id, name, items) on work_item_checklist to rabaed_app;

-- Like the Project's Trades and its Approved Supplier List: every Project Member of every Participant.
create policy member_reads_project_checklist_templates on checklist_template for select to rabaed_app
  using (project_id in (select app.current_project_ids()));
create policy member_reads_project_checklist_template_versions on checklist_template_version for select to rabaed_app
  using (project_id in (select app.current_project_ids()));
-- On an item the Member sees (the subquery is itself filtered by the RLS of work_item).
create policy member_reads_work_item_checklists on work_item_checklist for select to rabaed_app
  using (work_item_id in (select id from work_item));

-- Writes ---------------------------------------------------------------------------------------

-- Whether p_trade_id is a Trade of the Project p_project_id.
create function app.is_project_trade(p_project_id uuid, p_trade_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from dimension_value v join visibility_dimension d on d.id = v.dimension_id
        where v.id = p_trade_id and v.project_id = p_project_id and d.kind = 'trade'
      );
    end
  $$;

-- A Project Admin creates a Checklist Template on their Project, as its Version 1. Outcome:
-- 'created' (with the template), 'not_found' (not a Project the acting Member is a Project
-- Admin of, whether or not it exists), 'project_closed' or 'trade_not_found' (not a Trade
-- of this Project).
create function app.create_checklist_template(p_project_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz)
  returns table (outcome text, template_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_template_id uuid;
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- The Project row, shared, so it can't close between this check and the write.
      perform 1 from project where id = p_project_id for share;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.is_project_trade(p_project_id, p_trade_id) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template (project_id, created_by_member_id, created_at)
      values (p_project_id, app.current_member_id(), v_at)
      returning id into v_template_id;
      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, items, created_by_member_id, created_at)
      values (v_template_id, p_project_id, 1, p_name, p_trade_id, p_items, app.current_member_id(), v_at);
      perform app.write_setup_event(null, p_project_id, null, 'checklist_template_created',
        jsonb_build_object('checklist_template_id', v_template_id, 'version_no', 1, 'name', p_name), v_at);
      return query select 'created'::text, v_template_id;
    end
  $$;

-- A Project Admin edits a Checklist Template into its next Version; the earlier ones stay as
-- they were, on the items that copied them. Outcome: 'edited' (with the new Version), 'not_found'
-- (not a template of a Project the acting Member is a Project Admin of, whether or not it
-- exists), 'project_closed', 'template_retired' or 'trade_not_found'.
create function app.edit_checklist_template(p_template_id uuid, p_name jsonb, p_trade_id uuid, p_items jsonb, p_now timestamptz)
  returns table (outcome text, version_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_template checklist_template;
      v_version_id uuid;
      v_at timestamptz := greatest(p_now, now());
    begin
      select * into v_template from checklist_template
      where id = p_template_id and project_id in (select app.current_admin_project_ids())
      for update;
      if v_template.id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      perform 1 from project where id = v_template.project_id for share;
      if exists (select 1 from project where id = v_template.project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if v_template.status = 'retired' then
        return query select 'template_retired'::text, null::uuid;
        return;
      end if;
      if not app.is_project_trade(v_template.project_id, p_trade_id) then
        return query select 'trade_not_found'::text, null::uuid;
        return;
      end if;

      insert into checklist_template_version (checklist_template_id, project_id, version_no, name, trade_value_id, items, created_by_member_id, created_at)
      values (p_template_id, v_template.project_id, v_template.version_no + 1, p_name, p_trade_id, p_items, app.current_member_id(), v_at)
      returning id into v_version_id;
      update checklist_template set version_no = v_template.version_no + 1 where id = p_template_id;
      perform app.write_setup_event(null, v_template.project_id, null, 'checklist_template_edited',
        jsonb_build_object('checklist_template_id', p_template_id, 'version_no', v_template.version_no + 1, 'name', p_name), v_at);
      return query select 'edited'::text, v_version_id;
    end
  $$;

-- A Project Admin retires a Checklist Template: it is offered to no new pick, and the items
-- that copied it keep their copy. Outcome: 'retired' (also when it already was), 'not_found'
-- or 'project_closed'.
create function app.retire_checklist_template(p_template_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_template checklist_template;
      v_at timestamptz := greatest(p_now, now());
    begin
      select * into v_template from checklist_template
      where id = p_template_id and project_id in (select app.current_admin_project_ids())
      for update;
      if v_template.id is null then
        return 'not_found';
      end if;
      perform 1 from project where id = v_template.project_id for share;
      if exists (select 1 from project where id = v_template.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if v_template.status = 'active' then
        update checklist_template set status = 'retired', retired_by_member_id = app.current_member_id(), retired_at = v_at
        where id = p_template_id;
        perform app.write_setup_event(null, v_template.project_id, null, 'checklist_template_retired',
          jsonb_build_object('checklist_template_id', p_template_id), v_at);
      end if;
      return 'retired';
    end
  $$;

-- Makes the item's copies follow its `checklist_template` answers, after a save by the Member
-- who may save them now (app.can_save_answers): an answer whose Version the item already holds
-- keeps its copy as it is; a new one copies that Version's name and items; an answer cleared
-- deletes its copy. After the item's first Submit nothing changes (a Send Back that lets the
-- raiser edit the Form included). Outcome: 'synced', 'not_editable' (they may not save its
-- answers now, or it isn't an item they see), 'checklist_fixed' (an answer changed after the
-- first Submit) or 'template_not_found' (not a Version of one of the Project's templates for
-- the item's Trade). The API checks all of it first, so anything but 'synced' is unexpected
-- and rolls the save back.
create function app.sync_work_item_checklists(p_work_item_id uuid, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item work_item;
      v_trade_id uuid;
      v_key text;
      v_answer text;
      v_held uuid;
      v_version checklist_template_version;
    begin
      if not app.sees_work_item(p_work_item_id) or not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      select * into v_item from work_item where id = p_work_item_id;
      select wdv.dimension_value_id into v_trade_id
      from work_item_dimension_value wdv join visibility_dimension d on d.id = wdv.dimension_id and d.kind = 'trade'
      where wdv.work_item_id = p_work_item_id;
      for v_key in
        select f ->> 'key'
        from form_version fv
        cross join lateral jsonb_array_elements(fv.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where fv.id = v_item.form_version_id and f ->> 'type' = 'checklist_template'
      loop
        v_answer := case when jsonb_typeof(v_item.data -> v_key) = 'string' then v_item.data ->> v_key end;
        select checklist_template_version_id into v_held from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
        if v_answer is not distinct from v_held::text then
          continue;
        end if;
        if v_item.submitted_at is not null then
          return 'checklist_fixed';
        end if;
        if v_answer is null then
          delete from work_item_checklist where work_item_id = p_work_item_id and field_key = v_key;
          continue;
        end if;
        select * into v_version from checklist_template_version
        where id::text = v_answer and project_id = v_item.project_id and trade_value_id = v_trade_id;
        if v_version.id is null then
          return 'template_not_found';
        end if;
        insert into work_item_checklist (work_item_id, field_key, checklist_template_version_id, name, items, copied_at)
        values (p_work_item_id, v_key, v_version.id, v_version.name, v_version.items, greatest(p_now, now()))
        on conflict (work_item_id, field_key) do update
          set checklist_template_version_id = excluded.checklist_template_version_id, name = excluded.name,
              items = excluded.items, copied_at = excluded.copied_at;
      end loop;
      return 'synced';
    end
  $$;

revoke all on function
  app.is_project_trade(uuid, uuid),
  app.create_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz),
  app.edit_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz),
  app.retire_checklist_template(uuid, timestamptz),
  app.sync_work_item_checklists(uuid, timestamptz)
  from public;
-- app.is_project_trade is a helper of the writes, not for the app role.
grant execute on function
  app.create_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz),
  app.edit_checklist_template(uuid, jsonb, uuid, jsonb, timestamptz),
  app.retire_checklist_template(uuid, timestamptz),
  app.sync_work_item_checklists(uuid, timestamptz)
  to rabaed_app;
