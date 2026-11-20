-- RP-1319: before its first Submit an item has no Document Number (ADR 0030, RP-1316). This is what
-- RP-1316 left: the file names of its Working Copy and Documental Record, Rabaed Admin's search of a
-- stuck Step, and the public verification of a Record that never got a number (owner's decisions in
-- RP-1319's description and comments 15938 and 15987). Each function is redefined from its newest
-- body on main with only the change named here; every check, signature and grant stays.
--
-- * app.record_file_name (new, invoker sql helper, no grant): a numbered item's file is named by its
--   Document Number, as before ("TWR-MAR-01-0001 - Working Copy.pdf", "TWR-MAR-01-0001.pdf"); an item
--   with no number by its Work Item Type and Subject ("MAR - Cable trays - Working Copy.pdf",
--   "MAR - Cable trays.pdf"), never the bare Type code. Characters a file name can't hold become "_", and the Subject is cut to
--   100 characters (under 255 bytes in all), never left empty.
--   The Subject is already in the PDF the name is for, so the name tells its reader nothing new.
-- * app.request_working_copy, app.documental_record_file, app.linked_documental_record_file: the
--   file name only, through that helper.
-- * app.work_item_step_for_engineer(project, item): the item it looks for is the item's Document Number or its
--   id (Rabaed Admin takes the id out of the item's link, as the app links to it), on that Project
--   only. An item that never left Draft is still not found by its id (V1, ADR 0019: a Draft is its
--   author's alone), as it was never found by a number. No Subject search, and still rabaed_admin's
--   alone. The parameter keeps its name: Postgres can't rename one in place.
-- * app.verify_documental_record_by_code: a Record whose printed face has no Document Number is found
--   by its Verification Code alone, whatever the number field holds; a numbered Record still needs
--   its number with the code. The visitor's attempts are counted and limited first, as before, and
--   the answer is the same printed face (app.documental_record_verification, unchanged).

-- A plain invoker sql helper with no search_path, so it is inlined where it is read (CODING_STANDARDS.md, RP-310).
create function app.record_file_name(p_document_number text, p_type_code text, p_subject text, p_suffix text) returns text
  language sql immutable parallel safe
  as $$
    select case
      when p_document_number is not null then p_document_number || p_suffix
      -- At most 100 characters of the Subject, so even an Arabic one (2 bytes a character) keeps the name
      -- under the 255 bytes a file system allows; never empty.
      else p_type_code || ' - '
        || coalesce(nullif(btrim(left(btrim(
             regexp_replace(regexp_replace(coalesce(p_subject, ''), '[\\/:*?"<>|[:cntrl:]]', '_', 'g'), '\s+', ' ', 'g')
           ), 100)), ''), '_')
        || p_suffix
    end
  $$;
revoke all on function app.record_file_name(text, text, text, text) from public;

-- From 20270928000000_working_copy.sql; the 'ready' file name only.
create or replace function app.request_working_copy(p_work_item_id uuid, p_app_version text)
  returns table (outcome text, storage_key text, file_name text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_item record;
      v_content jsonb;
      v_hash bytea;
      v_copy working_copy;
      v_outbox_id uuid;
    begin
      if app.current_member_id() is null or coalesce(p_app_version, '') = '' or not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      select w.project_id, w.closed_at, w.document_number, w.title, t.code into v_item
      from work_item w join work_item_type t on t.id = w.work_item_type_id
      where w.id = p_work_item_id and w.discarded_at is null;
      if not found then
        return query select 'not_found'::text, null::text, null::text;
        return;
      end if;
      if v_item.closed_at is not null then
        return query select 'closed'::text, null::text, null::text;
        return;
      end if;
      v_content := app.working_copy_content(p_work_item_id);
      v_hash := sha256(convert_to(v_content::text, 'UTF8'));
      insert into working_copy (work_item_id, project_id, content_sha256, app_version)
      values (p_work_item_id, v_item.project_id, v_hash, p_app_version)
      on conflict on constraint working_copy_content_key do nothing;
      select * into v_copy from working_copy c
      where c.work_item_id = p_work_item_id and c.content_sha256 = v_hash and c.app_version = p_app_version
      for update;
      if v_copy.made_at is not null then
        return query select 'ready'::text, v_copy.storage_key,
          app.record_file_name(v_item.document_number, v_item.code, v_item.title, ' - Working Copy.pdf');
        return;
      end if;
      if v_copy.outbox_id is not null and v_copy.stale_at is null then
        if exists (select 1 from outbox o where o.id = v_copy.outbox_id and o.dead_at is not null) then
          return query select 'failed'::text, null::text, null::text;
        else
          return query select 'preparing'::text, null::text, null::text;
        end if;
        return;
      end if;
      -- New, or stale and asked for again: the worker makes it.
      insert into outbox (kind, project_id, payload)
      values ('working_copy', v_item.project_id, jsonb_build_object('working_copy_id', v_copy.id))
      returning id into v_outbox_id;
      update working_copy set outbox_id = v_outbox_id, stale_at = null where id = v_copy.id;
      return query select 'preparing'::text, null::text, null::text;
    end
  $$;
revoke all on function app.request_working_copy(uuid, text) from public;
grant execute on function app.request_working_copy(uuid, text) to rabaed_app;

-- From 20270709000000_documental_record.sql; the file name only.
create or replace function app.documental_record_file(p_work_item_id uuid)
  returns table (storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select f.storage_key,
          app.record_file_name(w.document_number, t.code, w.title, '.pdf')
        from documental_record r
        join stored_file f on f.id = r.pdf_file_id
        join work_item w on w.id = r.work_item_id
        join work_item_type t on t.id = w.work_item_type_id
        where r.work_item_id = p_work_item_id and r.status = 'published';
    end
  $$;
revoke all on function app.documental_record_file(uuid) from public;
grant execute on function app.documental_record_file(uuid) to rabaed_app;

-- From 20271106000000_linked_documental_record.sql; the file name only.
create or replace function app.linked_documental_record_file(p_work_item_id uuid, p_link_id uuid)
  returns table (storage_key text, file_name text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if app.current_member_id() is null or not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select f.storage_key,
          app.record_file_name(t.document_number, ty.code, t.title, '.pdf')
        from app.work_item_links(p_work_item_id) seen
        join work_item_link l on l.id = seen.id and l.from_id = p_work_item_id and l.removed_at is null
        join work_item t on t.id = l.to_id and t.closed_at is not null
        join work_item_type ty on ty.id = t.work_item_type_id
        join documental_record r on r.work_item_id = t.id and r.status = 'published'
        join stored_file f on f.id = r.pdf_file_id
        where seen.id = p_link_id;
    end
  $$;
revoke all on function app.linked_documental_record_file(uuid, uuid) from public;
grant execute on function app.linked_documental_record_file(uuid, uuid) to rabaed_app;

-- From 20271124000000_admin_reassign_step.sql; how it finds the item only (its Document Number, or its id once it left Draft).
create or replace function app.work_item_step_for_engineer(p_project_id uuid, p_document_number text)
  returns table (
    work_item_id uuid, document_number text, title text, type_name jsonb, closed boolean,
    step_name jsonb, stage_name jsonb, draft_step boolean, assignment_status text,
    participant_id uuid, company_name jsonb, role_name jsonb, holder_member_id uuid, pool jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  declare
    v_sought text := btrim(coalesce(p_document_number, ''));
    v_id uuid := case when v_sought ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_sought::uuid end;
  begin
  return query
  select w.id, w.document_number, w.title, t.name, w.closed_at is not null,
    s.name, coalesce(ps.name, rs.name), coalesce(app.is_draft_step(a.step_id), false), a.status,
    a.participant_id, c.legal_name, r.name, a.assignee_member_id,
    coalesce((
      select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', m.full_name, 'email', m.email) order by m.full_name ->> 'en', m.email)
      from app.assignment_pool(a.id) x join member m on m.id = x.member_id
    ), '[]'::jsonb)
  from work_item w
  join work_item_type t on t.id = w.work_item_type_id
  left join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'picked_up') and w.closed_at is null
  left join workflow_step s on s.id = a.step_id
  left join stage ps on ps.owner_kind = 'project' and ps.project_id = w.project_id and ps.module_key = t.module_key and ps.key = s.stage_key
  left join stage rs on rs.owner_kind = 'rabaed' and rs.module_key = t.module_key and rs.key = s.stage_key
  left join participant p on p.id = a.participant_id
  left join company c on c.id = p.company_id
  left join project_role r on r.id = p.project_role_id
  where w.project_id = p_project_id
    and (
      (w.document_number is not null and upper(w.document_number) = upper(v_sought))
      or (w.id = v_id and app.left_draft(w.left_draft_at, w.document_number))
    )
    and w.discarded_at is null;
  end
$$;
revoke all on function app.work_item_step_for_engineer(uuid, text) from public;
grant execute on function app.work_item_step_for_engineer(uuid, text) to rabaed_admin;

-- From 20270910000000_documental_record_verification.sql; the number match only (a Record with no number: the code alone).
create or replace function app.verify_documental_record_by_code(
  p_code text, p_document_number text, p_visitor_sha256 bytea, p_now timestamptz, p_limit integer, p_window interval
) returns table (outcome text, verification jsonb)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_verification jsonb;
    begin
      if p_visitor_sha256 is null or length(p_visitor_sha256) <> 32 or p_now is null or p_limit is null or p_limit < 1 or p_window is null then
        raise exception 'a visitor, the time and a limit are required' using errcode = '22023';
      end if;
      -- One visitor's attempts are counted one at a time, so a burst cannot slip past the limit.
      perform pg_advisory_xact_lock(hashtextextended('verification_attempt:' || encode(p_visitor_sha256, 'hex'), 0));
      delete from verification_attempt a where a.attempted_at <= p_now - p_window;
      if (select count(*) from verification_attempt a where a.visitor_sha256 = p_visitor_sha256 and a.attempted_at > p_now - p_window) >= p_limit then
        return query select 'too_many_attempts'::text, null::jsonb;
        return;
      end if;
      insert into verification_attempt (visitor_sha256, attempted_at) values (p_visitor_sha256, p_now);
      v_verification := app.documental_record_verification((
        select r.id
        from documental_record r
        join documental_record_face f on f.documental_record_id = r.id
        where r.verification_code = p_code
          and (
            f.document_number is null
            or upper(f.document_number) = upper(btrim(coalesce(p_document_number, '')))
          )
      ));
      return query select case when v_verification is null then 'not_found' else 'found' end, v_verification;
    end
  $$;
revoke all on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) from public;
grant execute on function app.verify_documental_record_by_code(text, text, bytea, timestamptz, integer, interval) to rabaed_app;
