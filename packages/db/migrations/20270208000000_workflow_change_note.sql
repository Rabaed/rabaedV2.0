-- RP-555 (spec RP-528; the owner's builder reference, decision 8): a published Workflow
-- Version keeps the Change Note its author wrote in the publish dialog, and the Versions
-- history shows it.
--
-- * workflow_change_note: one per published Version, written in the transaction that
--   publishes it. A table of its own, not a workflow_version column: a published Version
--   never changes (workflow_version_published_frozen), and the Change Note is read by the
--   Workflow's authors only (app.can_author_workflow), never by every Member who reads the
--   Version (V20): an exception Workflow's Change Note could otherwise tell C1 whom it is
--   for (V15). Append-only: nothing updates or deletes one.
-- * app.publish_workflow(uuid, timestamptz, text): the Project Admin's or Authorized Person's
--   publish with its Change Note. It is required (1 to 1000 characters, 'invalid_change_note'), and
--   refused on an exception Workflow when it names a Participant, as its name would be
--   ('change_note_names_participant'). The two-argument app.publish_workflow stays for the Library
--   copy published at once (saveWorkflowToLibrary) and Settings' publish of a copy, which
--   keep none.
-- * app.mark_workflow_published(uuid, timestamptz, text): Rabaed Admin's publish of a Rabaed
--   Default with its Change Note, as app.mark_workflow_published.

create table workflow_change_note (
  workflow_version_id uuid primary key references workflow_version (id),
  change_note text not null check (length(btrim(change_note)) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table workflow_change_note enable row level security;
revoke insert, update, delete on workflow_change_note from rabaed_app;
create policy author_reads_workflow_change_notes on workflow_change_note for select to rabaed_app
  using (app.can_author_workflow((select v.workflow_definition_id from workflow_version v where v.id = workflow_version_id)));

-- Writes the Change Note of Version p_version_id, just published. Internal: the publish commands call it.
create function app.write_workflow_change_note(p_version_id uuid, p_change_note text, p_at timestamptz) returns void
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    insert into workflow_change_note (workflow_version_id, change_note, created_at) values (p_version_id, btrim(p_change_note), p_at)
  $$;

-- A Project Admin or Authorized Person publishes the draft of a Workflow they author with
-- its Change Note. Outcomes: those of app.publish_workflow(uuid, timestamptz), and
-- 'invalid_change_note' (blank, or longer than 1000 characters); 'change_note_names_participant' (an
-- exception binds it, and the Change Note names one of its Project's Participants).
create function app.publish_workflow(p_definition_id uuid, p_now timestamptz, p_change_note text)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_refusal text := app.workflow_command_refusal(p_definition_id);
      v_change_note text := btrim(coalesce(p_change_note, ''));
      v_project_id uuid;
      v_published record;
    begin
      if v_refusal is not null then
        return query select v_refusal, null::uuid, null::integer;
        return;
      end if;
      if length(v_change_note) not between 1 and 1000 then
        return query select 'invalid_change_note'::text, null::uuid, null::integer;
        return;
      end if;
      select d.project_id into v_project_id from workflow_definition d where d.id = p_definition_id;
      if app.is_exception_workflow(p_definition_id)
        and app.names_participant(v_project_id, jsonb_build_object('en', v_change_note, 'ar', ''))
      then
        return query select 'change_note_names_participant'::text, null::uuid, null::integer;
        return;
      end if;
      select * into v_published from app.publish_workflow(p_definition_id, p_now);
      if v_published.outcome = 'published' then
        perform app.write_workflow_change_note(v_published.workflow_version_id, v_change_note, greatest(p_now, now()));
      end if;
      return query select v_published.outcome, v_published.workflow_version_id, v_published.version_no;
    end
  $$;

-- Rabaed Admin publishes a Rabaed Default's draft with its Change Note (admin_action logs the reason apart, V9).
create function app.mark_workflow_published(p_definition_id uuid, p_at timestamptz, p_change_note text)
  returns table (outcome text, workflow_version_id uuid, version_no integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_published record;
    begin
      select * into v_published from app.mark_workflow_published(p_definition_id, p_at);
      if v_published.outcome = 'published' and length(btrim(coalesce(p_change_note, ''))) between 1 and 1000 then
        perform app.write_workflow_change_note(v_published.workflow_version_id, p_change_note, p_at);
      end if;
      return query select v_published.outcome, v_published.workflow_version_id, v_published.version_no;
    end
  $$;

revoke all on function app.write_workflow_change_note(uuid, text, timestamptz) from public;
revoke all on function app.publish_workflow(uuid, timestamptz, text) from public;
grant execute on function app.publish_workflow(uuid, timestamptz, text) to rabaed_app;
revoke all on function app.mark_workflow_published(uuid, timestamptz, text) from public;
grant execute on function app.mark_workflow_published(uuid, timestamptz, text) to rabaed_admin;
