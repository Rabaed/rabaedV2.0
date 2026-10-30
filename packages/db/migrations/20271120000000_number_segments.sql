-- RP-1065 (spec RP-1054, owner decision C4; GLOSSARY "Document Number", "Numbering
-- Pattern", "Participant Code", "Version"; visibility.md, Document Numbers, scenario
-- RP-1065-1): what each part of an item's Document Number is, for the Submittal Panel's
-- "How this number is built" card.
--
-- * app.document_number_parts(segments, item): the printed value of each segment of a
--   pattern, in order, for a Work Item's attributes (as app.issue_document_number hands
--   them to app.document_numbering): `[{kind, value}]`, a Location segment with its
--   `level`. A segment that prints nothing (no Trade, no Location) is left out, as the
--   number leaves it out. Its values joined by the separator are app.document_numbering's
--   prefix; the seam-2 suite checks it on the shared cases.
-- * app.work_item_number_segments(item): for a Member who sees the item, its number's
--   segments, `{separator, segments}`, the sequence last as kind `sequence`; null for
--   anyone else, and for an item with no number. They come from the pattern Version the
--   number was issued under: the one in effect at the number's `numbered_at` (as
--   app.number_fixed_fields reads it; patterns are history once in effect, and a new one
--   is never in effect before it is saved). A Revision keeps its first item's number with
--   " Rev n": its segments are that number's, and the suffix is none of them.
--   The parts are rebuilt from the item (its Project's and Type's codes, its raiser's
--   Participant Code, or its order while it had none, its Trade and Location) and given
--   only when the rebuilt number is exactly the issued one. Otherwise (a code renamed since,
--   a number that was not built from a pattern) it is null, and the panel shows no card.
--   Nothing is stored and no existing item is changed: an item numbered before this
--   migration has its segments too, wherever the rebuild matches.
-- * What it gives is only what the number prints, each part named by its kind: no counter
--   key, no counter value, nothing about how the sequence counts (visibility.md, Document
--   Numbers). The kinds are the pattern's, which every Project Member reads already.

create function app.document_number_parts(p_segments jsonb, p_item jsonb) returns jsonb
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    with segment as (
      select s, n from jsonb_array_elements(p_segments) with ordinality as e (s, n)
    ),
    value as (
      select n, s, case s ->> 'kind'
        when 'project' then p_item ->> 'project_code'
        when 'type' then p_item ->> 'type_code'
        when 'trade' then p_item ->> 'trade_code'
        when 'participant' then coalesce(p_item ->> 'participant_code',
          lpad(p_item ->> 'participant_ordinal', greatest(2, length(p_item ->> 'participant_ordinal')), '0'))
        when 'location' then coalesce(
          p_item -> 'location_path' ->> ((s ->> 'level')::integer - 1), p_item -> 'location_path' ->> -1)
        when 'text' then s ->> 'text'
        end as v
      from segment
    )
    select coalesce(jsonb_agg(
      jsonb_build_object('kind', s ->> 'kind', 'value', v)
        || case when s ->> 'kind' = 'location' then jsonb_build_object('level', (s ->> 'level')::integer) else '{}'::jsonb end
      order by n) filter (where v is not null), '[]'::jsonb)
    from value
  $$;

create function app.work_item_number_segments(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item record;
      v_pattern record;
      v_attributes jsonb;
      v_code text;
      v_parts jsonb;
      v_prefix text;
      v_sequence text;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      -- The number's first item (the item itself, unless it is a Revision): what it was built from.
      select w.document_number, w.revision_no, r.id as root_id, r.document_number as root_number, r.numbered_at,
        r.project_id, r.work_item_type_id, pr.code as project_code, t.code as type_code,
        p.code as participant_code, p.ordinal
      into v_item
      from work_item w
      join work_item r on r.id = w.root_id
      join project pr on pr.id = r.project_id
      join work_item_type t on t.id = r.work_item_type_id
      join participant p on p.id = r.raised_by_participant_id
      where w.id = p_work_item_id;
      if v_item.root_number is null or v_item.numbered_at is null
        or v_item.document_number is distinct from (case when v_item.revision_no = 0 then v_item.root_number
          else v_item.root_number || ' Rev ' || v_item.revision_no end)
      then
        return null;
      end if;

      select * into v_pattern
      from app.numbering_pattern_in_effect(v_item.project_id, v_item.work_item_type_id, v_item.numbered_at);
      v_attributes := jsonb_build_object(
        'project_code', v_item.project_code,
        'type_code', v_item.type_code,
        'participant_ordinal', v_item.ordinal,
        'trade_code', (
          select v.code from work_item_dimension_value wv
          join visibility_dimension d on d.id = wv.dimension_id
          join dimension_value v on v.id = wv.dimension_value_id
          where wv.work_item_id = v_item.root_id and d.kind = 'trade'),
        'location_path', (
          with recursive up as (
            select v.id, v.parent_id, v.code, v.depth from work_item_dimension_value wv
            join visibility_dimension d on d.id = wv.dimension_id
            join dimension_value v on v.id = wv.dimension_value_id
            where wv.work_item_id = v_item.root_id and d.kind = 'location'
            union all
            select v.id, v.parent_id, v.code, v.depth from dimension_value v join up on v.id = up.parent_id
          )
          select coalesce(jsonb_agg(code order by depth), '[]'::jsonb) from up)
      );

      -- The raiser's Participant Code, or its order on the Project while it had none.
      foreach v_code in array array[v_item.participant_code, null] loop
        v_parts := app.document_number_parts(v_pattern.segments, v_attributes || jsonb_build_object('participant_code', v_code));
        select n.prefix into v_prefix
        from app.document_numbering(v_pattern.segments, v_pattern.separator, v_pattern.seq_scope,
          v_attributes || jsonb_build_object('participant_code', v_code)) n;
        v_sequence := substr(v_item.root_number, length(v_prefix || v_pattern.separator) + 1);
        if (select coalesce(string_agg(e ->> 'value', v_pattern.separator order by n), '') from jsonb_array_elements(v_parts) with ordinality as x (e, n)) = v_prefix
          and left(v_item.root_number, length(v_prefix || v_pattern.separator)) = v_prefix || v_pattern.separator
          and v_sequence ~ '^[0-9]{1,9}$'
          and app.sequenced_document_number(v_prefix, v_pattern.separator, v_pattern.seq_digits, v_sequence::integer) = v_item.root_number
        then
          return jsonb_build_object(
            'separator', v_pattern.separator,
            'segments', v_parts || jsonb_build_array(jsonb_build_object('kind', 'sequence', 'value', v_sequence)));
        end if;
        exit when v_item.participant_code is null;
      end loop;
      return null;
    end
  $$;

revoke all on function app.document_number_parts(jsonb, jsonb), app.work_item_number_segments(uuid) from public;
grant execute on function app.work_item_number_segments(uuid) to rabaed_app;
