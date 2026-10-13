-- A number printed with the Participant's order fixes the Participant Code too
-- (RP-508; GLOSSARY.md "Participant Code": fixed once a number uses it;
-- data-model.md participant.code_locked_at).
--
-- app.issue_document_number fixed the code only when the Participant had one. A
-- number issued while it had none (its order on the Project, 01, stands in) left
-- code_locked_at empty, so the Project Admin could still set a code, and that
-- Participant's later numbers switched from TWR-MAR-01-0003 to TWR-MAR-TMC-0001.
-- A starting number already fixed the order this way (starting_number_fixes_code
-- migration); a number issued now does as well.
--
-- * app.issue_document_number: as the skip_used_numbers migration left it, except
--   that a pattern with the Participant segment sets code_locked_at whether or not
--   the code is null. app.assign_participant_code then refuses any new code
--   ('code_in_use'). A pattern without the segment still leaves it empty.
-- * Backfill: a Participant with no code whose order an issued number already
--   printed (the pattern in effect when the item was numbered had the Participant
--   segment) is fixed from its first such number. A Participant that has a code
--   keeps it as it is.

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

      -- A number built with the Participant's code, or with its order while it has
      -- none, fixes it (RP-508). The update waits for a concurrent change of the
      -- code and then sees the new one; once fixed, the code is read under a share
      -- lock, so it can't change under this number.
      if exists (select 1 from jsonb_array_elements(v_pattern.segments) s where s ->> 'kind' = 'participant') then
        update participant set code_locked_at = p_at
        where id = v_item.participant_id and code_locked_at is null
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

update participant p set code_locked_at = printed.first_at
from (
  select w.raised_by_participant_id as participant_id, min(w.numbered_at) as first_at
  from work_item w
  join participant unfixed on unfixed.id = w.raised_by_participant_id
    and unfixed.code is null and unfixed.code_locked_at is null
  where w.document_number is not null and w.numbered_at is not null
    and exists (
      select 1 from app.numbering_pattern_in_effect(w.project_id, w.work_item_type_id, w.numbered_at) np,
        jsonb_array_elements(np.segments) s
      where s ->> 'kind' = 'participant')
  group by w.raised_by_participant_id
) printed
where p.id = printed.participant_id and p.code is null and p.code_locked_at is null;
