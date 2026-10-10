-- A Member's Appearance (owner decision 2026-10-11, spec RP-447): the Theme, Grey or Warm, and
-- the Mode, Light, Dark or System (the device's own setting), chosen in the member menu and kept
-- here so it follows the Member across devices. A Member's own preference, like their List
-- columns: nobody else reads or writes it, not even their Company. A Member with no row has the
-- default, Warm and System (defaultAppearance in @rabaed/domain).

create table member_appearance (
  member_id uuid primary key references member (id),
  theme text not null check (theme in ('grey', 'warm')),
  mode text not null check (mode in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

alter table member_appearance enable row level security;
-- Read only, the Member's own row; written through app.set_member_appearance.
revoke insert, update, delete, truncate on member_appearance from rabaed_app;
create policy member_reads_own_appearance on member_appearance for select to rabaed_app
  using (member_id = app.current_member_id());

-- Sets the acting Member's Appearance: 'set', or 'not_found' with no acting Member. A Theme or
-- Mode the app doesn't offer is refused by the table's checks.
create function app.set_member_appearance(p_theme text, p_mode text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if app.current_member_id() is null then
        return 'not_found';
      end if;
      insert into member_appearance (member_id, theme, mode)
      values (app.current_member_id(), p_theme, p_mode)
      on conflict (member_id) do update
        set theme = excluded.theme, mode = excluded.mode, updated_at = now();
      return 'set';
    end
  $$;

revoke all on function app.set_member_appearance(text, text) from public;
grant execute on function app.set_member_appearance(text, text) to rabaed_app;
