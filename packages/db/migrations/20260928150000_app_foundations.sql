-- Foundations for tenancy (ADR 0007).
--
-- The API sets the acting Member as a transaction-local setting on every request
-- (set_config('app.member_id', <uuid>, true)); RLS policies read it through
-- app.current_member_id(). With no Member set it is null, so policies match nothing.

create schema app;
grant usage on schema app to rabaed_app;

create function app.current_member_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.member_id', true), '')::uuid $$;

-- Every table the migrator creates in public is usable by the app role, but only
-- through row-level security: each tenant table must enable RLS in its migration
-- (the seam-2 suite fails on any table without it). Tables that must be
-- append-only revoke UPDATE and DELETE in their own migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to rabaed_app;
alter default privileges in schema public
  grant usage, select on sequences to rabaed_app;
