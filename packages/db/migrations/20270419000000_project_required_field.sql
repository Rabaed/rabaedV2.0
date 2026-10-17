-- RP-82 (INSP-2, spec RP-649): a link question a Project makes required (form-engine.md §2.13,
-- data-model.md project_required_field, visibility.md V20).
--
-- * A Project Admin makes one of a Work Item Type's link questions (`work_item_ref`) required
--   on their Project, such as the WIR's Approved submittals: the Project setting "Approved
--   submittals required". The API then reads that field as required on the Project's items of
--   that Type (form.ts requiredByProject), so an item can't leave Draft without an item chosen
--   there, whatever Form Version it is pinned to. Off: as the Form says.
-- * One row per Project, Type and field key while it is on; turning it off deletes the row.
--   The API checks the key is a link question of the Form a new item of the Type gets there.
-- * Every Project Member of every Participant reads which fields are required (like the
--   Project's Workflows, V20): it is the Project's rule, not anyone's work. The app role reads
--   the Project, Type and key only, never who set it.
-- * Anyone but the Project's Project Admins who tries to change it gets 'not_found', exactly
--   like a made-up Project (404, never 403). rabaed_app writes only through
--   app.set_project_required_field, and a Closed Project answers 'project_closed'.

create table project_required_field (
  project_id uuid not null references project (id),
  work_item_type_id uuid not null references work_item_type (id),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$' and length(field_key) <= 64),
  set_by_member_id uuid not null references member (id),
  set_at timestamptz not null default now(),
  primary key (project_id, work_item_type_id, field_key)
);
create index project_required_field_work_item_type_id_idx on project_required_field (work_item_type_id);
create index project_required_field_set_by_member_id_idx on project_required_field (set_by_member_id);

alter table project_required_field enable row level security;
revoke all on project_required_field from rabaed_app;
grant select (project_id, work_item_type_id, field_key) on project_required_field to rabaed_app;

create policy member_reads_project_required_fields on project_required_field for select to rabaed_app
  using (project_id in (select app.current_project_ids()));

-- A Project Admin makes the field p_field_key of the Type p_type_code required on their
-- Project (p_required) or not. The Type is the Project's own of that code, else the Rabaed
-- Default. Outcome: 'set' (also when it already was so), 'not_found' (not a Project the acting
-- Member is a Project Admin of, whether or not it exists), 'project_closed' or
-- 'type_not_found'.
create function app.set_project_required_field(p_project_id uuid, p_type_code text, p_field_key text, p_required boolean, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type_id uuid;
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_type_id := app.project_type_id(p_project_id, p_type_code);
      if v_type_id is null then
        return 'type_not_found';
      end if;
      if p_required then
        insert into project_required_field (project_id, work_item_type_id, field_key, set_by_member_id, set_at)
        values (p_project_id, v_type_id, p_field_key, app.current_member_id(), greatest(p_now, now()))
        on conflict do nothing;
      else
        delete from project_required_field
        where project_id = p_project_id and work_item_type_id = v_type_id and field_key = p_field_key;
      end if;
      return 'set';
    end
  $$;

revoke all on function app.set_project_required_field(uuid, text, text, boolean, timestamptz) from public;
grant execute on function app.set_project_required_field(uuid, text, text, boolean, timestamptz) to rabaed_app;
