-- RP-1239: rename and deactivate a Project's Trades and Locations (follow-up to RP-1156, gap row 11;
-- owner's decisions of 2026-11-07 on the ticket). Scenarios RP-1239-1 to RP-1239-4.
--
-- * dimension_value.status {active, deactivated}, as Scopes have. The screen says "Archive"; the data
--   model says "deactivated", so "archived" stays reserved for Closed Projects.
-- * app.update_dimension_value: a Project Admin renames a Trade or Location (its name only: the code
--   is fixed, decision 5), deactivates or reactivates it. Anyone else gets 'not_found', exactly like
--   a made-up id (404, never 403). The General Trade (GEN) is never deactivated (decision 1).
--   Deactivating a Location deactivates every Location below it, and one below a deactivated
--   Location is not reactivated (decision 2, like app.update_scope's 'parent_deactivated').
-- * A deactivated value keeps the grants and Work Items that already use it: nobody loses or gains
--   Visibility. It is never picked anew: app.check_work_item_built_ins refuses it on a new item (an
--   item keeps its own), and the grant functions refuse it unless the grant already covers it.
-- * app.project_visibility_gap counts a deactivated value only while a Work Item uses it (decision 3),
--   and with app.participant_covered_values returns each value's status.
-- * app.documental_record_facts leaves deactivated Trades out of page 1's Trade list, except the
--   item's own (decision 4). Records already made never change (ADR 0023).

alter table dimension_value
  add column status text not null default 'active' check (status in ('active', 'deactivated'));

-- Writes -----------------------------------------------------------------------

-- A Project Admin renames value p_value_id of dimension p_kind (p_name), deactivates or reactivates it
-- (p_active), or both; null leaves that part as it is. Outcome: 'updated', 'not_found' (not a value of
-- that dimension on a Project the acting Member is a Project Admin of, whether or not it exists),
-- 'project_closed', 'general_trade' (deactivating GEN) or 'parent_deactivated' (reactivating a
-- Location inside a deactivated one: reactivate that one first).
create function app.update_dimension_value(p_value_id uuid, p_kind text, p_name jsonb, p_active boolean, p_now timestamptz)
  returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_value record;
      v_at timestamptz := greatest(p_now, now());
    begin
      select v.id, v.project_id, v.parent_id, v.code into v_value
      from dimension_value v
      join visibility_dimension d on d.id = v.dimension_id and d.kind = p_kind
      where v.id = p_value_id and v.project_id in (select app.current_admin_project_ids())
      for update of v;
      if v_value.id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_value.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_active is false and p_kind = 'trade' and v_value.code = 'GEN' then
        return 'general_trade';
      end if;
      if p_active and exists (select 1 from dimension_value parent where parent.id = v_value.parent_id and parent.status = 'deactivated') then
        return 'parent_deactivated';
      end if;

      update dimension_value set
        name = coalesce(p_name, name),
        status = case when p_active is null then status when p_active then 'active' else 'deactivated' end,
        updated_at = v_at
      where id = p_value_id;
      if p_active is false then
        -- Every Location below it (Trades have none).
        with recursive below (id) as (
          select c.id from dimension_value c where c.parent_id = p_value_id
          union all
          select c.id from dimension_value c join below b on c.parent_id = b.id
        )
        update dimension_value set status = 'deactivated', updated_at = v_at
        where id in (select id from below) and status <> 'deactivated';
      end if;
      return 'updated';
    end
  $$;

revoke execute on function app.update_dimension_value(uuid, text, jsonb, boolean, timestamptz) from public;
grant execute on function app.update_dimension_value(uuid, text, jsonb, boolean, timestamptz) to rabaed_app;

-- A deactivated value is refused on a new item; an item keeps its own. From 20270209000000's body.
create or replace function app.check_work_item_built_ins(
  p_work_item_id uuid, p_project_id uuid, p_project_member_id uuid,
  p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[]
) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade_dimension uuid := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension uuid := app.project_dimension_id(p_project_id, 'location');
      v_scope_ids uuid[] := array(select distinct x from unnest(coalesce(p_scope_ids, '{}')) x where x is not null);
      v_fixed text[] := case when p_work_item_id is null then '{}'::text[] else app.number_fixed_fields(p_work_item_id) end;
    begin
      if p_trade_id is null then
        return 'trade_required';
      end if;
      if 'trade' = any (v_fixed) and p_trade_id is distinct from (
        select wv.dimension_value_id from work_item_dimension_value wv
        where wv.work_item_id = p_work_item_id and wv.dimension_id = v_trade_dimension)
      or 'location' = any (v_fixed) and p_location_id is distinct from (
        select wv.dimension_value_id from work_item_dimension_value wv
        where wv.work_item_id = p_work_item_id and wv.dimension_id = v_location_dimension)
      then
        return 'number_part_fixed';
      end if;
      if not exists (
          select 1 from dimension_value v where v.id = p_trade_id and v.dimension_id = v_trade_dimension
            and (v.status = 'active' or exists (
              select 1 from work_item_dimension_value wv where wv.work_item_id = p_work_item_id and wv.dimension_value_id = v.id)))
        or (p_location_id is not null
          and not exists (
            select 1 from dimension_value v where v.id = p_location_id and v.dimension_id = v_location_dimension
              and (v.status = 'active' or exists (
                select 1 from work_item_dimension_value wv where wv.work_item_id = p_work_item_id and wv.dimension_value_id = v.id))))
        or exists (
          select 1 from unnest(v_scope_ids) chosen (id)
          where not exists (
            select 1 from scope s
            where s.id = chosen.id and s.project_id = p_project_id and s.trade_value_id = p_trade_id
              and (s.parent_id is null or s.parent_id = any (v_scope_ids))
              and (s.status = 'active' or exists (
                select 1 from work_item_scope ws where ws.work_item_id = p_work_item_id and ws.scope_id = s.id))
          ))
      then
        return 'value_not_found';
      end if;
      if p_trade_id not in (select app.values_covered_by_project_member(p_project_member_id, v_trade_dimension))
        or (p_location_id is not null
          and p_location_id not in (select app.values_covered_by_project_member(p_project_member_id, v_location_dimension)))
      then
        return 'outside_visibility';
      end if;
      return 'ok';
    end
  $$;

-- A Participant grant may list a deactivated value only when it already covers it. From
-- 20261005000000's body.
create or replace function app.set_participant_visibility(
  p_participant_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
      v_member_grant record;
    begin
      -- Locked, so a Member's grant is never checked against a Participant grant
      -- that is changing at the same time (see app.set_member_visibility).
      select project_id into v_project_id from participant
      where id = p_participant_id and status = 'active' and project_id in (select app.current_admin_project_ids())
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;
      if exists (
        select unnest(v_values)
        intersect select id from dimension_value where dimension_id = v_dimension_id and status = 'deactivated'
        except select app.values_covered_by_participant(p_participant_id, v_dimension_id)
      ) then
        return 'value_not_found';
      end if;

      insert into visibility_grant as g (project_id, subject_kind, participant_id, dimension_id, is_all)
      values (v_project_id, 'participant', p_participant_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);

      -- Each Member's grant becomes its intersection with what the Participant now covers, stored
      -- as the topmost values, so widening the Participant again doesn't widen them.
      -- A Member's "all" already means all of the Participant's.
      for v_member_grant in
        select id from visibility_grant
        where participant_id = p_participant_id and project_member_id is not null
          and dimension_id = v_dimension_id and not is_all
      loop
        perform app.replace_grant_values(v_member_grant.id, array(
          with kept as (
            select app.values_covered_by_grant(v_member_grant.id) as id
            intersect
            select app.values_covered_by_participant(p_participant_id, v_dimension_id)
          )
          select v.id from kept k join dimension_value v on v.id = k.id
          where v.parent_id is null or v.parent_id not in (select id from kept)
        ));
        update visibility_grant set updated_at = v_at where id = v_member_grant.id;
      end loop;
      return 'set';
    end
  $$;

-- A Project Member grant may list a deactivated value only when it already covers it. From
-- 20260928230000's body.
create or replace function app.set_member_visibility(
  p_participant_id uuid, p_member_id uuid, p_kind text, p_is_all boolean, p_value_ids uuid[], p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_at timestamptz := greatest(p_now, now());
      v_values uuid[] := case when p_is_all then '{}' else coalesce(p_value_ids, '{}') end;
      v_project_id uuid;
      v_project_member_id uuid;
      v_dimension_id uuid;
      v_grant_id uuid;
    begin
      -- Locked, so the Participant's grant can't narrow between the check below and the write.
      select project_id into v_project_id from participant
      where id = p_participant_id and company_id = v_company_id and status = 'active'
      for update;
      if v_project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      select id into v_project_member_id from project_member
      where participant_id = p_participant_id and member_id = p_member_id and status = 'active';
      if v_project_member_id is null then
        return 'member_not_found';
      end if;
      v_dimension_id := app.project_dimension_id(v_project_id, p_kind);
      if exists (select unnest(v_values) except select id from dimension_value where dimension_id = v_dimension_id) then
        return 'value_not_found';
      end if;
      if exists (
        select unnest(v_values)
        intersect select id from dimension_value where dimension_id = v_dimension_id and status = 'deactivated'
        except select app.values_covered_by_project_member(v_project_member_id, v_dimension_id)
      ) then
        return 'value_not_found';
      end if;
      if exists (select unnest(v_values) except select app.values_covered_by_participant(p_participant_id, v_dimension_id)) then
        return 'exceeds_participant';
      end if;

      insert into visibility_grant as g
        (project_id, subject_kind, participant_id, project_member_id, dimension_id, is_all)
      values (v_project_id, 'project_member', p_participant_id, v_project_member_id, v_dimension_id, p_is_all)
      on conflict on constraint visibility_grant_subject_dimension_key
        do update set is_all = excluded.is_all, updated_at = v_at
      returning g.id into v_grant_id;
      perform app.replace_grant_values(v_grant_id, v_values);
      return 'set';
    end
  $$;

-- Reads ------------------------------------------------------------------------

-- As 20261108000000's body, with each value's status.
drop function app.participant_covered_values(uuid);
create function app.participant_covered_values(p_participant_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name, v.status
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join dimension_value v on v.id = c.id
        where p.id = p_participant_id and p.status = 'active'
          and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;
revoke execute on function app.participant_covered_values(uuid) from public;
grant execute on function app.participant_covered_values(uuid) to rabaed_app;

-- As 20271205000000's body, with each value's status, and a deactivated value only while a Work Item
-- of the Project uses it.
drop function app.project_visibility_gap(uuid);
create function app.project_visibility_gap(p_project_id uuid)
  returns table (kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name, v.status
        from visibility_dimension d
        join dimension_value v on v.dimension_id = d.id
        where d.project_id = p_project_id
          and p_project_id in (select app.current_admin_project_ids())
          and (v.status = 'active' or exists (select 1 from work_item_dimension_value wv where wv.dimension_value_id = v.id))
          and v.id not in (
            select c.id
            from participant p
            cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
            where p.project_id = p_project_id and p.status = 'active'
          )
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;
revoke execute on function app.project_visibility_gap(uuid) from public;
grant execute on function app.project_visibility_gap(uuid) to rabaed_app;

-- Page 1's Trade list leaves deactivated Trades out, except the item's own (decision 4). From
-- 20271105000000's body; only the Trade list's filter changes.
create or replace function app.documental_record_facts(p_outbox_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_item_id uuid;
      v_answers jsonb;
      v_facts jsonb;
    begin
      perform app.require_worker();
      v_item_id := app.documental_record_item(p_outbox_id);
      if v_item_id is null or exists (select 1 from documental_record r where r.work_item_id = v_item_id) then
        return null;
      end if;
      v_answers := coalesce(app.shared_answers_of(v_item_id), '{}'::jsonb);
      select jsonb_build_object(
          'workItemId', w.id,
          'projectId', w.project_id,
          'projectName', pr.name,
          'recordLanguage', pr.record_language,
          'hijriDates', pr.record_hijri_dates,
          'type', jsonb_build_object('code', t.code, 'name', t.name),
          'documentNumber', w.document_number,
          'revisionNo', w.revision_no,
          'revisionOf', (
            select jsonb_build_object('documentNumber', o.document_number, 'closedAt', app.iso_utc(o.closed_at), 'outcome', o.outcome)
            from work_item o
            where o.id = w.revision_of_id and o.closed_at is not null and o.document_number is not null
          ),
          'subject', w.title,
          'outcome', w.outcome,
          'closedAt', app.iso_utc(w.closed_at),
          'submittedAt', app.iso_utc(w.submitted_at),
          'raiserParticipantId', w.raised_by_participant_id,
          'pdf', fv.schema -> 'pdf',
          'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'polarity', o.polarity, 'actions', o.actions) order by o.sort, o.code)
            from outcome o
            where o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
          ), '[]'::jsonb),
          'companies', app.record_fact_companies(w.id),
          'trades', coalesce((
            select jsonb_agg(jsonb_build_object('name', dv.name, 'selected', dv.id = it.dimension_value_id) order by dv.sort, dv.id)
            from dimension_value dv
            join visibility_dimension d on d.id = dv.dimension_id and d.kind = 'trade' and d.project_id = w.project_id
            left join (
              select x.dimension_value_id from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'trade'
              where x.work_item_id = w.id
            ) it on true
            -- Deactivated Trades are left out, except the item's own (RP-1239, decision 4).
            where dv.parent_id is null and (dv.status = 'active' or dv.id = it.dimension_value_id)
          ), '[]'::jsonb),
          -- The Location as the path from its first level down.
          'location', (
            with recursive up (id, parent_id, name, depth) as (
              select dv.id, dv.parent_id, dv.name, dv.depth
              from work_item_dimension_value x
              join visibility_dimension xd on xd.id = x.dimension_id and xd.kind = 'location'
              join dimension_value dv on dv.id = x.dimension_value_id
              where x.work_item_id = w.id
              union all
              select dv.id, dv.parent_id, dv.name, dv.depth from dimension_value dv join up on dv.id = up.parent_id
            )
            select jsonb_agg(up.name order by up.depth) from up
          ),
          'scopes', coalesce((
            select jsonb_agg(s.name order by s.depth, s.sort, s.id)
            from work_item_scope ws join scope s on s.id = ws.scope_id
            where ws.work_item_id = w.id
          ), '[]'::jsonb),
          'reviewComments', (
            select count(*) from work_item_link l
            join work_item c on c.id = l.from_id and c.discarded_at is null
            where l.to_id = w.id and l.kind = 'raised_from'
          ),
          'comments', app.record_fact_comments(w.id),
          -- Rabaed's own cancel when a Company left the Project (workflow-engine.md §9): no Member took it.
          'cancelledByRabaed', (
            select jsonb_build_object('companyName', co.legal_name)
            from work_item_event e
            join participant p on p.id = app.uuid_or_null(e.payload -> 'left_participant_id')
            join company co on co.id = p.company_id
            where e.work_item_id = w.id and e.type = 'cancelled' and e.actor_member_id is null and w.outcome = 'cancelled'
            order by e.seq desc
            limit 1
          ),
          'form', jsonb_build_object(
            'sections', fv.schema -> 'sections',
            'answers', v_answers,
            'optionLists', coalesce((
              select jsonb_agg(jsonb_build_object('id', ol.id, 'name', ol.name) order by ol.created_at, ol.id)
              from option_list ol where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'options', coalesce((
              select jsonb_agg(jsonb_build_object('id', op.id, 'optionListId', op.option_list_id, 'parentId', op.parent_id,
                'value', op.value, 'label', op.label, 'retired', op.retired) order by op.created_at, op.id) -- hidden-sort-key: an Option List's own options, Rabaed's rows, never an item's time
              from option op join option_list ol on ol.id = op.option_list_id
              where position(ol.id::text in fv.schema::text) > 0
            ), '[]'::jsonb),
            'suppliers', coalesce((
              select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name))
              from approved_supplier s
              where s.project_id = w.project_id and s.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'approved_supplier')
            ), '[]'::jsonb),
            'companyNames', coalesce((
              select jsonb_object_agg(p.id, co.legal_name)
              from participant p join company co on co.id = p.company_id
              where p.project_id = w.project_id and p.id in (
                select app.uuid_or_null(v_answers -> (f ->> 'key'))
                from jsonb_array_elements(fv.schema -> 'sections') sec
                cross join lateral jsonb_array_elements(sec -> 'fields') f
                where f ->> 'type' = 'participant')
            ), '{}'::jsonb)
          ),
          -- The Checklist Template Versions the item copied (RP-651), which its reply checklists answer
          -- (RP-982); whoever sees the item reads them.
          'checklistCopies', coalesce((
            select jsonb_agg(jsonb_build_object(
                'fieldKey', c.field_key, 'versionId', c.checklist_template_version_id, 'name', c.name, 'items', c.items
              ) order by c.field_key)
            from work_item_checklist c
            where c.work_item_id = w.id
          ), '[]'::jsonb),
          -- The Documents the other Participants saw, in the order they were added, each with its
          -- fingerprint (RP-618): none of an item never Submitted, none added after the arrival the
          -- close follows (the close counts one arrival itself), so never one the holder added while
          -- it held the item at the close (V19), except a reply Document a shared event took, such as
          -- the closing code's checklist photos (RP-982): that event shared it.
          'documents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'fileName', d.file_name, 'contentType', d.content_type, 'size', d.size_bytes::bigint, 'storageKey', d.storage_key,
              'fieldKey', d.field_key, 'itemKey', d.item_key, 'takenAt', app.iso_utc(d.taken_at),
              'sha256', encode(d.file_sha256, 'hex')
            ) order by d.created_at, d.id) -- hidden-sort-key: the order they were added is what app.document_times (seq) already tells every reader, never the times
            from app.documents_shared_before_close(w.id) d
          ), '[]'::jsonb),
          'transitions', app.record_fact_transitions(w.id)
        )
      into v_facts
      from work_item w
      join project pr on pr.id = w.project_id
      join work_item_type t on t.id = w.work_item_type_id
      join form_version fv on fv.id = w.form_version_id
      where w.id = v_item_id and w.closed_at is not null and w.discarded_at is null;
      return v_facts;
    end
  $$;
