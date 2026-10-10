-- Card view layout (RP-410): the optional parts of a Kanban card, switched by each
-- Member for each board (one Module of one Project). A Member's own preference:
-- nobody else reads or writes it, not even their Company, and only on a Project
-- they are on. A Member with no row sees the default (the Contractor name off,
-- the Location and the date on: defaultBoardCardLayout in @rabaed/domain).

create table member_board_layout (
  member_id uuid not null references member (id),
  project_id uuid not null references project (id),
  module_key text not null,
  contractor_name boolean not null,
  location boolean not null,
  creation_date boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, project_id, module_key)
);

alter table member_board_layout enable row level security;
-- Read only, the Member's own rows on their own Projects; written through
-- app.set_board_layout, like every Project table.
revoke insert, update, delete, truncate on member_board_layout from rabaed_app;
create policy member_reads_own_board_layout on member_board_layout for select to rabaed_app
  using (member_id = app.current_member_id() and project_id in (select app.current_project_ids()));

-- Sets the acting Member's layout of a Project's board: 'set', or 'not_found' for a
-- Project they are not on (the api answers it like a Project that doesn't exist).
create function app.set_board_layout(
  p_project_id uuid, p_module_key text, p_contractor_name boolean, p_location boolean, p_creation_date boolean
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_project_id is null or p_project_id not in (select app.current_project_ids()) or app.current_member_id() is null then
        return 'not_found';
      end if;
      insert into member_board_layout (member_id, project_id, module_key, contractor_name, location, creation_date)
      values (app.current_member_id(), p_project_id, p_module_key, p_contractor_name, p_location, p_creation_date)
      on conflict (member_id, project_id, module_key) do update
        set contractor_name = excluded.contractor_name, location = excluded.location,
          creation_date = excluded.creation_date, updated_at = now();
      return 'set';
    end
  $$;

revoke all on function app.set_board_layout(uuid, text, boolean, boolean, boolean) from public;
grant execute on function app.set_board_layout(uuid, text, boolean, boolean, boolean) to rabaed_app;
