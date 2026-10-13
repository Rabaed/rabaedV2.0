-- RP-453: found by the published-Version catalogue test
-- (packages/db/test/published-version-immutability.test.ts). workflow_change_note hangs off
-- a Workflow Version and had no row trigger: RP-555 made it append-only by grants alone
-- (rabaed_app has no write), so the table's owner could still change or delete the Change
-- Note of a published Version.
--
-- The guard refuses UPDATE and DELETE when the note's Version is published, the same rule
-- as every other guard off a Version (frozen once published, editable while a draft), and
-- the same error code. Chosen over refusing outright, or over a check that a note exists
-- only for a published Version: publishing writes the note in the same transaction as the
-- status change, and a rule keyed on the Version's status is the one the catalogue test
-- tries for real; a note can't be written for a draft by rabaed_app anyway (no grant).
-- INSERT stays open: that is the one write the publish makes, once per Version (the
-- primary key), and the test lists it as an excused INSERT.
--
-- security definer: it reads workflow_version without the caller's row-level security, as
-- app.refuse_published_workflow_part_change does.

create function app.refuse_workflow_change_note_change() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (select 1 from workflow_version v where v.id = old.workflow_version_id and v.status = 'published')
         or (tg_op = 'UPDATE' and exists (
            select 1 from workflow_version v where v.id = new.workflow_version_id and v.status = 'published'))
      then
        raise exception 'a published workflow_version never changes (% of its workflow_change_note)', tg_op
          using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger workflow_change_note_published_frozen before update or delete on workflow_change_note
  for each row execute function app.refuse_workflow_change_note_change();

revoke all on function app.refuse_workflow_change_note_change() from public;
