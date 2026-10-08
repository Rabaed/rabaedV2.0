-- RP-424 (spec RP-423, ADR 0016): a published Workflow Version never changes.
--
-- Form Versions have had this guard since RP-262 (form_version_published_frozen);
-- Workflow Versions had none, and 20261026000000_action_forms.sql changed MAR v1
-- in place after it was published. That change is history and stays as it is.
-- With an authoring API coming, the database refuses it, as it does for Forms:
--   - an UPDATE or DELETE of a published workflow_version, even by its owner;
--   - an UPDATE or DELETE of a workflow_step or workflow_transition row of a
--     published Version (the row as it was, so a row can't be moved out of one
--     either).
-- A draft stays editable, and publishing it (status draft -> published) is allowed
-- because the row it changes is still a draft. Same error code as the Form guard.

create function app.refuse_published_workflow_version_change() returns trigger
  language plpgsql
  as $$
    begin
      if old.status = 'published' then
        raise exception 'a published workflow_version never changes' using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger workflow_version_published_frozen before update or delete on workflow_version
  for each row execute function app.refuse_published_workflow_version_change();

create function app.refuse_published_workflow_part_change() returns trigger
  language plpgsql
  as $$
    begin
      if exists (
        select 1 from workflow_version v where v.id = old.workflow_version_id and v.status = 'published'
      ) then
        raise exception 'a published workflow_version never changes (% of its %)', tg_op, tg_table_name
          using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger workflow_step_published_frozen before update or delete on workflow_step
  for each row execute function app.refuse_published_workflow_part_change();
create trigger workflow_transition_published_frozen before update or delete on workflow_transition
  for each row execute function app.refuse_published_workflow_part_change();

revoke all on function app.refuse_published_workflow_version_change() from public;
revoke all on function app.refuse_published_workflow_part_change() from public;
