-- A Document Number already used is skipped (RP-311 review, settled with the
-- user; workflow-engine.md §8 "Duplicate numbers").
--
-- Two counters can build the same number: under the Rabaed Default the MAR
-- counter TWR-MAR-01 issues TWR-MAR-01-0001; a pattern change that keeps the
-- segments but stops counting by the Participant starts the counter TWR-MAR,
-- whose first number is TWR-MAR-01-0001 again. work_item_document_number_key
-- (project_id, document_number) refused it, so the Transition failed.
--
-- app.issue_document_number now takes the counter's next value until the number
-- is one the Project hasn't used: the counter moves past the used value, which is
-- never issued again. Each counter stays gap-free except for the values it skips.
-- The number is checked under an advisory lock on (Project, number), so two
-- Transitions building the same number from different counters at once queue,
-- and the second skips it once the first commits. The unique index stays, and
-- serves the check.
--
-- Otherwise as the participant_codes migration left it (the Participant Code is
-- fixed by a number that prints the Participant segment), with the pattern from
-- app.numbering_pattern_in_effect and the number from
-- app.sequenced_document_number (starting_number_fixes_code migration).

create or replace function app.issue_document_number(p_work_item_id uuid, p_at timestamptz) returns text
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_pattern record;
      v_attributes jsonb;
      v_numbering record;
      v_seq integer;
      v_number text;
      v_participant_code text;
    begin
      select w.project_id, w.work_item_type_id, pr.code as project_code, t.code as type_code, p.ordinal,
        p.id as participant_id
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      where w.id = p_work_item_id;

      select * into v_pattern from app.numbering_pattern_in_effect(v_item.project_id, v_item.work_item_type_id, p_at);

      -- A number built with the Participant's code fixes it. The update waits for a
      -- concurrent change of the code and then sees the new one; once fixed, the
      -- code is read under a share lock, so it can't change under this number.
      if exists (select 1 from jsonb_array_elements(v_pattern.segments) s where s ->> 'kind' = 'participant') then
        update participant set code_locked_at = p_at
        where id = v_item.participant_id and code is not null and code_locked_at is null
        returning code into v_participant_code;
        if not found then
          select code into v_participant_code from participant where id = v_item.participant_id for share;
        end if;
      end if;

      v_attributes := jsonb_build_object(
        'project_code', v_item.project_code,
        'type_code', v_item.type_code,
        'participant_code', v_participant_code, -- null: the ordinal stands in
        'participant_ordinal', v_item.ordinal,
        'trade_code', (
          select v.code from work_item_dimension_value wv
          join visibility_dimension d on d.id = wv.dimension_id
          join dimension_value v on v.id = wv.dimension_value_id
          where wv.work_item_id = p_work_item_id and d.kind = 'trade'),
        'location_path', (
          with recursive up as (
            select v.id, v.parent_id, v.code, v.depth from work_item_dimension_value wv
            join visibility_dimension d on d.id = wv.dimension_id
            join dimension_value v on v.id = wv.dimension_value_id
            where wv.work_item_id = p_work_item_id and d.kind = 'location'
            union all
            select v.id, v.parent_id, v.code, v.depth from dimension_value v join up on v.id = up.parent_id
          )
          select coalesce(jsonb_agg(code order by depth), '[]'::jsonb) from up)
      );
      select * into v_numbering
      from app.document_numbering(v_pattern.segments, v_pattern.separator, v_pattern.seq_scope, v_attributes);

      loop
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_numbering.counter_key, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := app.sequenced_document_number(v_numbering.prefix, v_pattern.separator, v_pattern.seq_digits, v_seq);
        perform pg_advisory_xact_lock(hashtextextended('document_number/' || v_item.project_id || '/' || v_number, 0));
        exit when not exists (
          select 1 from work_item w where w.project_id = v_item.project_id and w.document_number = v_number);
      end loop;
      return v_number;
    end
  $$;
