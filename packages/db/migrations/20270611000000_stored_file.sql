-- RP-85 (spec RP-632): stored_file, one immutable row per file Rabaed keeps in object storage
-- that is not a Document (data-model.md §6): a Member's Signature image now; a Company's logo
-- and Stamp (RP-617) and a Documental Record's PDF and Record Data (RP-620) next. A new upload
-- is a new row, so whatever pointed at the old one (a Transition's Signature, a record's Stamp)
-- keeps it. Only this table, its row security and grants: what may read a row comes with what
-- points at it (each table adds its own policy), and rows are written only by `app.*`
-- functions and the record job, never by the app role.
--
-- * `storage_key`: where the file lives in object storage (unique).
-- * `sha256`: the stored bytes' fingerprint. Not granted to the app role, like a Document's
--   and the content hash.
-- * `size`, `mime`: the file's size in bytes and its content type.
-- * `uploaded_by_member_id`: the Member who uploaded it; null when Rabaed made it (the record
--   job). Not granted to the app role.
-- * `created_at`.

create table stored_file (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique check (length(storage_key) > 0),
  sha256 bytea not null check (length(sha256) = 32),
  size bigint not null check (size > 0),
  mime text not null check (length(mime) > 0),
  uploaded_by_member_id uuid references member (id),
  created_at timestamptz not null default now()
);

-- Immutable: never changed or removed, by any role.
create function app.refuse_stored_file_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'stored_file is immutable' using errcode = '42501';
    end
  $$;
revoke all on function app.refuse_stored_file_change() from public;
create trigger stored_file_immutable before update or delete on stored_file
  for each row execute function app.refuse_stored_file_change();
create trigger stored_file_no_truncate before truncate on stored_file
  for each statement execute function app.refuse_stored_file_change();

-- No policy here: the app role reads no row until a table that points at it adds one.
alter table stored_file enable row level security;
revoke all on stored_file from rabaed_app;
grant select (id, storage_key, size, mime, created_at) on stored_file to rabaed_app;
revoke insert, update, delete, truncate on stored_file from rabaed_admin;
