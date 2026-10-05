-- A starting number fixes the Participant Code (RP-311 review, settled with the
-- user; workflow-engine.md §8 "Participant Code" and "Starting numbers";
-- data-model.md participant.code_locked_at).
--
-- A counter set up ahead whose key holds a Participant's printed value (its
-- Participant Code, or its position while it has none) would never be used if
-- the code then changed: the next number would fall under another key. So
-- setting the starting number fixes that Participant's code, exactly as a number
-- using the code does, from the Project Admin (app.set_numbering_counter_start)
-- and from Rabaed Admin (app.start_numbering_counter) alike: once fixed, the
-- code can't be set or changed ('code_in_use').
--
-- * participant.code_locked_at may now be set while the code is null: the
--   position was fixed, so no code can be set.
-- * app.numbering_pattern_in_effect(project, type, at): the pattern a Work Item
--   of the Type numbered at `at` follows (the Type's, else the Project's, else
--   the Rabaed Default). One definition, for app.start_numbering_counter here and
--   app.issue_document_number (skip_used_numbers migration).
-- * app.sequenced_document_number(prefix, separator, digits, seq): a number from
--   its prefix and sequence value, zero-padded to the digits and never cut; the
--   database's copy of @rabaed/domain's builder (numbering.ts), tested against
--   the same cases.
-- * app.start_numbering_counter: as the numbering_admin migration left it, except
--   that it locks the Participant row first (so it queues with
--   app.assign_participant_code and builds the key with the code it fixes), and,
--   once the starting number is set, fixes the code when the pattern counts by
--   the Participant.

alter table participant drop constraint participant_code_locked_has_code;

create function app.numbering_pattern_in_effect(p_project_id uuid, p_work_item_type_id uuid, p_at timestamptz)
  returns table (segments jsonb, separator text, seq_digits smallint, seq_scope jsonb)
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select * from (
      select np.segments, np.separator, np.seq_digits, np.seq_scope
      from numbering_pattern np
      where np.project_id = p_project_id and np.effective_from <= p_at
        and (np.work_item_type_id = p_work_item_type_id or np.work_item_type_id is null)
      order by np.work_item_type_id is null, np.effective_from desc, np.id desc
      limit 1
    ) p
    union all
    -- The Rabaed Default: Project, Type, Participant Code, 4 digits, counted by all three.
    select '[{"kind": "project"}, {"kind": "type"}, {"kind": "participant"}]'::jsonb, '-', 4::smallint, '[0, 1, 2]'::jsonb
    where not exists (
      select 1 from numbering_pattern np
      where np.project_id = p_project_id and np.effective_from <= p_at
        and (np.work_item_type_id = p_work_item_type_id or np.work_item_type_id is null))
  $$;

create function app.sequenced_document_number(p_prefix text, p_separator text, p_seq_digits integer, p_seq integer) returns text
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select p_prefix || p_separator || lpad(p_seq::text, greatest(p_seq_digits, length(p_seq::text)), '0')
  $$;

create or replace function app.start_numbering_counter(
  p_project_id uuid, p_type_code text, p_participant_id uuid, p_trade_id uuid, p_location_id uuid,
  p_starting_value integer, p_now timestamptz
) returns table (outcome text, counter_key text, next_number text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_counter record;
      v_pattern record;
    begin
      -- Queues with app.assign_participant_code: the key is built with the code this fixes.
      perform 1 from participant where id = p_participant_id and project_id = p_project_id for update;
      select * into v_counter from app.numbering_counter_for(
        p_project_id, p_type_code, p_participant_id, p_trade_id, p_location_id, v_at);
      if v_counter.outcome <> 'found' then
        return query select v_counter.outcome, null::text, null::text;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::text, null::text;
        return;
      end if;
      -- Atomic against a first number issued at the same moment: the update only
      -- applies while the counter has issued nothing.
      insert into numbering_counter as c (project_id, counter_key, last_value, starting_value)
      values (p_project_id, v_counter.counter_key, p_starting_value - 1, p_starting_value)
      on conflict (project_id, counter_key) do update
        set last_value = excluded.last_value, starting_value = excluded.starting_value
        where c.starting_value is not null and c.last_value = c.starting_value - 1;
      if not found then
        return query select 'counter_used'::text, null::text, null::text;
        return;
      end if;

      -- RP-311 review: the key holds the Participant's code (or position): fix it.
      select p.* into v_pattern
      from app.numbering_pattern_in_effect(p_project_id, (
        select t.id from work_item_type t
        where t.code = p_type_code and (t.project_id = p_project_id or t.project_id is null)
        order by t.project_id nulls last limit 1), v_at) p;
      if p_participant_id is not null and app.counts_by_participant(v_pattern.segments, v_pattern.seq_scope) then
        update participant set code_locked_at = coalesce(code_locked_at, v_at) where id = p_participant_id;
      end if;

      return query select 'set'::text, v_counter.counter_key,
        app.sequenced_document_number(v_counter.prefix, v_counter.separator, v_counter.seq_digits, p_starting_value);
    end
  $$;

revoke all on function
  app.numbering_pattern_in_effect(uuid, uuid, timestamptz),
  app.sequenced_document_number(text, text, integer, integer)
  from public;
