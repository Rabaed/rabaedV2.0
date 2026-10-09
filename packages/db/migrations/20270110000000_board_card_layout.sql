-- Card view layout (RP-410): the optional parts of a Kanban card, switched by each
-- Member for each board (one Module of one Project). A Member's own preference:
-- nobody else reads or writes it, not even their Company, and only on a Project
-- they are on. A Member with no row sees the default (the Contractor name off,
-- the plan location and the date on: defaultBoardCardLayout in @rabaed/domain).

create table member_board_layout (
  member_id uuid not null references member (id),
  project_id uuid not null references project (id),
  module_key text not null,
  contractor_name boolean not null,
  plan_location boolean not null,
  creation_date boolean not null,
  updated_at timestamptz not null default now(),
  primary key (member_id, project_id, module_key)
);

alter table member_board_layout enable row level security;
-- The Member's own rows, on their own Projects only.
create policy member_owns_board_layout on member_board_layout for all to rabaed_app
  using (member_id = app.current_member_id() and project_id in (select app.current_project_ids()))
  with check (member_id = app.current_member_id() and project_id in (select app.current_project_ids()));
revoke truncate on member_board_layout from rabaed_app;
