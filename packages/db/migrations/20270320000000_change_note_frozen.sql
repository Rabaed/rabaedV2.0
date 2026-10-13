-- RP-453: found by the published-Version catalogue test
-- (packages/db/test/published-version-immutability.test.ts). workflow_change_note hangs off
-- a Workflow Version and had no row trigger: RP-555 made it append-only by grants alone
-- (rabaed_app has no write), so the table's owner could still change or delete the Change
-- Note of a published Version. A note exists only for a published Version (it is written in
-- the transaction that publishes it), so UPDATE and DELETE are refused outright, with the
-- same error code as the other guards. INSERT stays open: that is the one write the publish
-- makes, once per Version (the primary key), and the test lists it as an excused INSERT.

create function app.refuse_workflow_change_note_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'a published workflow_version never changes (% of its workflow_change_note)', tg_op
        using errcode = '42501';
    end
  $$;
create trigger workflow_change_note_published_frozen before update or delete on workflow_change_note
  for each row execute function app.refuse_workflow_change_note_change();

revoke all on function app.refuse_workflow_change_note_change() from public;
