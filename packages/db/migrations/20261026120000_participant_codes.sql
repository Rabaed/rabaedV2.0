-- Participant Codes (RP-314, spec RP-311; GLOSSARY.md "Participant Code";
-- data-model.md participant.code; visibility.md V15).
--
-- A Project Admin gives each Participant a short code (2 to 6 letters or digits,
-- at least one a letter, stored in capitals, unique in the Project) that stands
-- for it in Document Numbers where the Numbering Pattern has the Participant
-- segment. Until it is set the Participant's position (01, 02...) stands in, as
-- before. Once a number has been built with the code it is fixed.
--
-- * The letter rule keeps a code from ever equalling a printed position ("01"):
--   an ordinal and a code can't share a counter key, so one Company's numbers
--   never run in another's count.
-- * The counter key under the Rabaed Default includes whatever the Participant
--   segment prints. A Participant numbered by position and then given a code
--   starts a counter of its own under the code; the numbers issued under the
--   position stay valid and are never reissued (the keys differ).
-- * Who sees a code is who sees the Participant row (V15): its own Company's
--   Members, and the Project Admins, who see every Participant. The column adds
--   no other read path.

alter table participant add column code text;
-- When a number was first built with the code: from then on it is fixed.
alter table participant add column code_locked_at timestamptz;
alter table participant add constraint participant_code_shape
  check (code is null or (code ~ '^[A-Z0-9]{2,6}$' and code ~ '[A-Z]'));
alter table participant add constraint participant_code_locked_has_code
  check (code_locked_at is null or code is not null);
create unique index participant_project_code_key on participant (project_id, code) where code is not null;

-- A Project Admin sets a Participant's code. Outcomes: 'set'; 'not_found' (the
-- Participant isn't one the acting Member may see); 'project_closed';
-- 'invalid_code'; 'duplicate_code' (another Participant of the Project has it);
-- 'code_in_use' (a number already uses the Participant's code). A Member who sees
-- the Participant but isn't a Project Admin is refused with 42501. Setting the
-- code a Participant already has changes nothing.
create function app.set_participant_code(p_participant_id uuid, p_code text) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_participant record;
      v_code text := upper(btrim(p_code));
    begin
      select p.project_id, p.company_id, p.status into v_participant
      from participant p where p.id = p_participant_id;
      -- What the Member may see: any Participant of a Project they administer, else their own Company's.
      if v_participant.project_id is null
        or v_participant.status <> 'active'
        or v_participant.project_id not in (select app.current_project_ids())
        or not (
          v_participant.company_id = app.current_company_id()
          or v_participant.project_id in (select app.current_admin_project_ids())
        )
      then
        return 'not_found';
      end if;
      if v_participant.project_id not in (select app.current_admin_project_ids()) then
        raise exception 'only a Project Admin can set a Participant Code' using errcode = '42501';
      end if;
      if exists (select 1 from project where id = v_participant.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if v_code is null or v_code !~ '^[A-Z0-9]{2,6}$' or v_code !~ '[A-Z]' then
        return 'invalid_code';
      end if;

      -- Queues with app.issue_document_number, which fixes the code it builds a number with.
      perform 1 from participant where id = p_participant_id for update;
      if exists (select 1 from participant where id = p_participant_id and code = v_code) then
        return 'set';
      end if;
      if exists (select 1 from participant where id = p_participant_id and code_locked_at is not null) then
        return 'code_in_use';
      end if;
      update participant set code = v_code, updated_at = now() where id = p_participant_id;
      return 'set';
    exception when unique_violation then
      return 'duplicate_code';
    end
  $$;
revoke all on function app.set_participant_code(uuid, text) from public;
grant execute on function app.set_participant_code(uuid, text) to rabaed_app;

-- Issuing numbers ------------------------------------------------------------------
-- RP-314's change to app.issue_document_number (as RP-312 defined it) is the
-- three places marked "RP-314": the Participant's id is read, and, where the
-- pattern has the Participant segment, its code is read and fixed, and handed to
-- the builder as 'participant_code'. Everything else is RP-312's, unchanged; a
-- merge with other changes to this function keeps those three places.
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
      v_participant_code text; -- RP-314
    begin
      select w.project_id, w.work_item_type_id, pr.code as project_code, t.code as type_code, p.ordinal,
        p.id as participant_id -- RP-314
      into v_item
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      where w.id = p_work_item_id;

      select np.segments, np.separator, np.seq_digits, np.seq_scope into v_pattern
      from numbering_pattern np
      where np.project_id = v_item.project_id and np.effective_from <= p_at
        and (np.work_item_type_id = v_item.work_item_type_id or np.work_item_type_id is null)
      order by np.work_item_type_id is null, np.effective_from desc, np.id desc
      limit 1;
      if v_pattern.segments is null then
        -- The Rabaed Default: Project, Type, Participant Code, 4 digits, counted by all three.
        select '[{"kind": "project"}, {"kind": "type"}, {"kind": "participant"}]'::jsonb as segments,
          '-' as separator, 4::smallint as seq_digits, '[0, 1, 2]'::jsonb as seq_scope
        into v_pattern;
      end if;

      -- RP-314: a number built with the Participant's code fixes it. The update waits
      -- for a concurrent change of the code and then sees the new one; once fixed, the
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
        'participant_code', v_participant_code, -- RP-314 (null: the ordinal stands in)
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

      insert into numbering_counter as c (project_id, counter_key, last_value)
      values (v_item.project_id, v_numbering.counter_key, 1)
      on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
      returning last_value into v_seq;
      return v_numbering.prefix || v_pattern.separator
        || lpad(v_seq::text, greatest(v_pattern.seq_digits, length(v_seq::text)), '0');
    end
  $$;
