-- Option Lists (form-engine.md §10; RP-279, spec RP-278).
--
-- * An Option List is a Rabaed Default: a list with EN/AR labels whose options
--   sit in up to three levels (list, sub-list, sub-sub-list). Each option has a
--   stable `value`, EN/AR labels and a `retired` flag. Retiring never deletes
--   an option: Work Items that chose it keep showing it (marked retired).
-- * Only Rabaed Admin's role (rabaed_admin) writes them, each edit with a reason
--   in admin_action. The customer app's role only reads them: every active
--   Member, on every Project. No Form field uses them yet (RP-282).
-- * An option's list, parent, level and value never change after it is added,
--   so a Work Item's stored `value` always means the same option; rename changes
--   the label only. Nothing is ever deleted, by anyone.

create table option_list (
  id uuid primary key default app.uuid_v7(),
  name jsonb not null check (app.is_bilingual(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table option (
  id uuid primary key default app.uuid_v7(),
  option_list_id uuid not null references option_list (id),
  parent_id uuid,
  -- 1 for an option of the list itself; set from the parent by the trigger below.
  level smallint not null check (level between 1 and 3),
  value text not null check (value ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  label jsonb not null check (app.is_bilingual(label)),
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_list_value_key unique (option_list_id, value),
  constraint option_list_id_key unique (id, option_list_id),
  -- A parent is an option of the same list.
  constraint option_parent_fkey foreign key (parent_id, option_list_id) references option (id, option_list_id),
  check ((parent_id is null) = (level = 1))
);
create index option_parent_idx on option (parent_id);

-- The level follows the parent's, to at most three.
create function app.set_option_level() returns trigger
  language plpgsql
  as $$
    begin
      if new.parent_id is null then
        new.level := 1;
      else
        select level + 1 into new.level from option where id = new.parent_id;
        if new.level > 3 then
          raise exception 'an Option List has at most three levels' using errcode = '23514';
        end if;
      end if;
      return new;
    end
  $$;
create trigger option_level before insert on option
  for each row execute function app.set_option_level();

-- Only the label and the retired flag ever change.
create function app.refuse_option_identity_change() returns trigger
  language plpgsql
  as $$
    begin
      if new.option_list_id is distinct from old.option_list_id
        or new.parent_id is distinct from old.parent_id
        or new.level is distinct from old.level
        or new.value is distinct from old.value then
        raise exception 'an option''s list, parent and value never change' using errcode = '42501';
      end if;
      return new;
    end
  $$;
create trigger option_identity_frozen before update on option
  for each row execute function app.refuse_option_identity_change();

alter table option_list enable row level security;
alter table option enable row level security;

-- Rabaed Defaults are read by every active Member; nobody else, and no writes.
revoke insert, update, delete, truncate on option_list, option from rabaed_app;
create policy member_reads_option_lists on option_list for select to rabaed_app
  using (app.current_company_id() is not null);
create policy member_reads_options on option for select to rabaed_app
  using (app.current_company_id() is not null);

-- Rabaed Admin edits but never deletes.
revoke delete, truncate on option_list, option from rabaed_admin;

-- Each edit is an Engineer action with a reason.
alter table admin_action drop constraint admin_action_action_check;
alter table admin_action add constraint admin_action_action_check
  check (action in (
    'onboard_company', 'read_onboarding_leads', 'invite_authorized_person', 'close_onboarding_lead',
    'create_option_list', 'add_option', 'rename_option', 'retire_option', 'restore_option'
  ));
