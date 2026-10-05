-- The Project Admin sets the Numbering Pattern (RP-313, spec RP-311;
-- workflow-engine.md §8 "Settled 2026-10-05 (Document numbering)"; data-model.md
-- numbering_pattern; visibility.md, Document Numbers, scenarios 53 and 54).
--
-- app.set_numbering_pattern: a Project Admin saves the Project's pattern, or a
-- Work Item Type's override, as a new numbering_pattern row in effect from now.
-- Issued numbers never change: app.issue_document_number takes the pattern in
-- effect when an item first leaves Draft. Rows are still never written directly
-- through the app role. A pattern whose sequence doesn't count by the Participant
-- Code is saved only with the shared-counter warning accepted; the acceptance is
-- recorded as shared_counter_accepted_at, and the one who accepted it is the
-- saver, set_by_member_id.

-- Outcome: 'saved'; 'not_found' (not a Project the acting Member is a Project
-- Admin of, whether it exists or not, so it names nothing); 'project_closed';
-- 'type_not_found' (not a Work Item Type the Project can use); 'invalid_pattern'
-- (more than 6 segments, an unknown segment, a separator other than '-' or '/',
-- digits outside 3–7, or counting by a segment it doesn't have);
-- 'shared_counter_not_accepted'.
create function app.set_numbering_pattern(
  p_project_id uuid, p_work_item_type_id uuid, p_segments jsonb, p_separator text, p_seq_digits integer,
  p_seq_scope jsonb, p_shared_counter_accepted boolean, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_work_item_type_id is not null and not exists (
        select 1 from work_item_type t
        where t.id = p_work_item_type_id and (t.project_id is null or t.project_id = p_project_id)
      ) then
        return 'type_not_found';
      end if;
      if p_separator is null or p_separator not in ('-', '/') or p_seq_digits is null or p_seq_digits not between 3 and 7
        or not coalesce(app.is_numbering_pattern(p_segments, p_seq_scope), false)
      then
        return 'invalid_pattern';
      end if;
      if not app.counts_by_participant(p_segments, p_seq_scope) and not coalesce(p_shared_counter_accepted, false) then
        return 'shared_counter_not_accepted';
      end if;

      insert into numbering_pattern (
        project_id, work_item_type_id, segments, separator, seq_digits, seq_scope,
        shared_counter_accepted_at, set_by_member_id, effective_from, created_at
      ) values (
        p_project_id, p_work_item_type_id, p_segments, p_separator, p_seq_digits, p_seq_scope,
        -- Recorded only where the warning applies.
        case when not app.counts_by_participant(p_segments, p_seq_scope) then v_at end,
        app.current_member_id(), v_at, v_at
      );
      return 'saved';
    end
  $$;

revoke all on function app.set_numbering_pattern(uuid, uuid, jsonb, text, integer, jsonb, boolean, timestamptz) from public;
grant execute on function app.set_numbering_pattern(uuid, uuid, jsonb, text, integer, jsonb, boolean, timestamptz) to rabaed_app;
