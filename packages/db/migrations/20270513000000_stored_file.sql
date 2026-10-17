-- RP-85 stored_file: STAND-IN copied by RP-620 until lane 2a's own file replaces this one byte for byte.
--
-- data-model.md §6: a stored file's bytes live in object storage under
-- `storage_key`; the row keeps their SHA-256, size and type, and who stored it.
-- Rows are immutable: a new upload is a new row. Not granted to the app role;
-- the functions that need a file read it as their owner.

create table stored_file (
  id uuid primary key default app.uuid_v7(),
  storage_key text not null unique,
  sha256 bytea not null check (octet_length(sha256) = 32),
  size bigint not null check (size >= 0),
  mime text not null,
  uploaded_by uuid references member (id),
  created_at timestamptz not null default now()
);
alter table stored_file enable row level security;
revoke all on stored_file from rabaed_app;

create function app.stored_file_is_immutable() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      raise exception 'stored_file rows are immutable' using errcode = '55000';
    end
  $$;
revoke all on function app.stored_file_is_immutable() from public;

create trigger stored_file_is_immutable before update or delete on stored_file
  for each row execute function app.stored_file_is_immutable();
