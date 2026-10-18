-- RP-640 (spec RP-631, story 26): the `drafts_imported` notification, "N Drafts were imported
-- for you" (data-model.md §9 notification; visibility.md "Notifications and emails").
--
-- Additive (RP-603 claim 14188): a new notification kind and a new outbox kind; no existing
-- kind changes, and no notification function is redefined.
--
-- * When a Register Import is confirmed, each Member its rows were assigned to, other than
--   the importer, gets one outbox row `drafts_imported` (trigger
--   submittal_register_import_outbox_drafts_imported), in the confirm's own transaction.
-- * The worker delivers it through app.deliver_drafts_imported: nothing for a closed
--   Project; else one notification, through app.notify_member like every other (as the
--   recipient: they still see the item; their routing: mute, pause, and the kind's email,
--   a digest by default as for any group with no setting). It points at the first of
--   their Drafts not Deleted since; with none left, nothing.
-- * app.drafts_imported_count(item) gives how many Drafts the import created for that
--   Draft's raiser: to the raiser themselves (the bell), or to the worker (the email).
--   Nothing goes to another Company: an assignee is a Member of the importing Participant.

alter table notification drop constraint notification_kind_check;
alter table notification add constraint notification_kind_check
  check (kind in ('step_reached', 'watched_event', 'sent_back', 'drafts_imported'));

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check
  check (kind in ('notification', 'email', 'digest', 'step_age_report', 'drafts_imported'));

-- Each assignee of a confirmed import's created rows but the importer: one outbox row.
create function app.outbox_drafts_imported() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outbox (kind, project_id, payload)
      select 'drafts_imported', new.project_id, jsonb_build_object('import_id', new.id, 'member_id', r.assignee_member_id)
      from submittal_register_import_row r
      where r.import_id = new.id and r.work_item_id is not null
        and r.assignee_member_id is not null and r.assignee_member_id <> new.run_by_member_id
      group by r.assignee_member_id;
      return new;
    end
  $$;
revoke all on function app.outbox_drafts_imported() from public;

create trigger submittal_register_import_outbox_drafts_imported after update of status on submittal_register_import
  for each row when (old.status = 'previewed' and new.status = 'created')
  execute function app.outbox_drafts_imported();

-- Delivers outbox row p_outbox_id (kind drafts_imported) to its Member: one notification of
-- the first of their Drafts the import created that isn't Deleted, through app.notify_member
-- (as the recipient, by their routing). Nothing for a closed Project. Returns how many
-- notifications were written (0 or 1). The worker's only: refuses a Member's session.
create function app.deliver_drafts_imported(p_outbox_id uuid) returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_row record;
      v_member_id uuid;
      v_import record;
      v_item uuid;
    begin
      perform app.require_worker();
      select o.* into v_row from outbox o where o.id = p_outbox_id and o.kind = 'drafts_imported';
      if v_row.id is null then
        return 0;
      end if;
      v_member_id := (v_row.payload ->> 'member_id')::uuid;
      -- A closed Project goes quiet.
      select i.id, i.project_id into v_import from submittal_register_import i
      join project p on p.id = i.project_id and p.status = 'active'
      where i.id = (v_row.payload ->> 'import_id')::uuid and i.status = 'created';
      if v_import.id is null then
        return 0;
      end if;
      select r.work_item_id into v_item
      from submittal_register_import_row r
      join work_item w on w.id = r.work_item_id
      where r.import_id = v_import.id and r.assignee_member_id = v_member_id and w.discarded_at is null
      order by r.row_no
      limit 1;
      if v_item is null then
        return 0;
      end if;
      return app.notify_member(
        p_outbox_id, v_member_id, v_import.project_id, v_item, 'drafts_imported', null, null, null, null, null, null);
    end
  $$;
revoke all on function app.deliver_drafts_imported(uuid) from public;
grant execute on function app.deliver_drafts_imported(uuid) to rabaed_app;

-- How many Drafts the Register Import that created Draft p_work_item_id created for its
-- raiser (rows assigned to them, created on confirm, Deleted since or not); null for a Draft
-- no import assigned. Answered to that raiser while they see it (their bell), and to the
-- worker (their email); null to anyone else.
create function app.drafts_imported_count(p_work_item_id uuid) returns integer
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
    begin
      select w.import_id, w.created_by_member_id into v_item from work_item w where w.id = p_work_item_id;
      if v_item.import_id is null
        or (app.current_member_id() is not null
          and (v_item.created_by_member_id <> app.current_member_id() or not app.sees_work_item(p_work_item_id)))
      then
        return null;
      end if;
      return (
        select nullif(count(*)::integer, 0) from submittal_register_import_row r
        where r.import_id = v_item.import_id and r.assignee_member_id = v_item.created_by_member_id and r.work_item_id is not null
      );
    end
  $$;
revoke all on function app.drafts_imported_count(uuid) from public;
grant execute on function app.drafts_imported_count(uuid) to rabaed_app;
