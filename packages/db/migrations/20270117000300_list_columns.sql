-- The List's column layout (RP-409, the owner's design): each Member's own order of
-- the List's columns per Module, each shown or not, kept by "Save as my default". A
-- Member's own preference, like the Card view layout: nobody else reads or writes it,
-- not even their Company. A Member with no row sees the design's columns
-- (defaultListColumns in @rabaed/domain); the api checks the column names
-- (listColumnLayout) and reads the row through listColumns, which adds any column
-- the row lacks.

create table member_list_columns (
  member_id uuid not null references member (id),
  module_key text not null check (module_key ~ '^[a-z][a-z_]{0,62}$'),
  columns jsonb not null check (jsonb_typeof(columns) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (member_id, module_key)
);

alter table member_list_columns enable row level security;
-- Read only, the Member's own rows; written through app.set_list_columns.
revoke insert, update, delete, truncate on member_list_columns from rabaed_app;
create policy member_reads_own_list_columns on member_list_columns for select to rabaed_app
  using (member_id = app.current_member_id());

-- Sets the acting Member's columns of a Module's List: 'set', or 'not_found' with no
-- acting Member. A layout that isn't a JSON array is refused by the table's check.
create function app.set_list_columns(p_module_key text, p_columns jsonb) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if app.current_member_id() is null then
        return 'not_found';
      end if;
      insert into member_list_columns (member_id, module_key, columns)
      values (app.current_member_id(), p_module_key, p_columns)
      on conflict (member_id, module_key) do update
        set columns = excluded.columns, updated_at = now();
      return 'set';
    end
  $$;

revoke all on function app.set_list_columns(text, jsonb) from public;
grant execute on function app.set_list_columns(text, jsonb) to rabaed_app;
