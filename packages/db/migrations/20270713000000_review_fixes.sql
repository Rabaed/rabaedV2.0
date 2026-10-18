-- RP-632 review fixes (spec RP-632: RP-85 the Signature, RP-617 the Company's logo and Stamp;
-- data-model.md §1 member_signature and company).
--
-- * app.set_member_signature: as 20270710000000_member_signature.sql left it, plus: the image's
--   `p_storage_key` must be under the acting Member's own Signatures,
--   `members/<member>/signatures/`, and never climb out of it (`..`); anything else is refused
--   (22023) with nothing written.
-- * app.set_company_image: as 20270712000000_company_stamp.sql left it, plus: `p_storage_key`
--   must be under the Company's own folder for that kind, `companies/<company>/<logo|stamp>/`,
--   and never climb out of it; refused (22023) with nothing written. Checked after `not_found`
--   and `forbidden`, so another Company's Member still learns nothing.
-- * app.active_signature_id and app.member_company_has_stamp: granted to the app role, so the
--   api asks the same gate app.take_transition checks. Both are invoker functions, so the app
--   role reads through row security: the first gives the acting Member's own Signature (null
--   for anyone else's, member_reads_own_signatures), the second answers for the acting
--   Member's own Company only (false for anyone else's, member_reads_own_company).

create or replace function app.set_member_signature(
  p_storage_key text, p_sha256 bytea, p_size bigint, p_mime text, p_method text, p_now timestamptz
) returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid := app.current_member_id();
      v_at timestamptz := greatest(p_now, now());
      v_file_id uuid;
      v_signature_id uuid;
    begin
      if v_member_id is null then
        return null;
      end if;
      if p_mime not in ('image/png', 'image/jpeg') then
        raise exception 'A Signature is a PNG or JPEG image' using errcode = '22023';
      end if;
      if not starts_with(p_storage_key, 'members/' || v_member_id || '/signatures/') or strpos(p_storage_key, '..') > 0 then
        raise exception 'A Signature image is stored under the Member''s own Signatures' using errcode = '22023';
      end if;
      -- One save at a time per Member, so one row stays active.
      perform 1 from member where id = v_member_id for update;
      update member_signature set active_to = v_at where member_id = v_member_id and active_to is null;
      insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id, created_at)
      values (p_storage_key, p_sha256, p_size, p_mime, v_member_id, v_at)
      returning id into v_file_id;
      insert into member_signature (member_id, file_id, method, active_from)
      values (v_member_id, v_file_id, p_method, v_at)
      returning id into v_signature_id;
      return v_signature_id;
    end
  $$;

create or replace function app.set_company_image(
  p_company_id uuid, p_kind text, p_storage_key text, p_sha256 bytea, p_size bigint, p_mime text, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_member_id uuid := app.current_member_id();
      v_at timestamptz := greatest(p_now, now());
      v_company record;
      v_file_id uuid;
    begin
      if p_kind not in ('logo', 'stamp') then
        raise exception 'A Company image is its logo or its Stamp' using errcode = '22023';
      end if;
      if p_mime not in ('image/png', 'image/jpeg') then
        raise exception 'A logo or Stamp is a PNG or JPEG image' using errcode = '22023';
      end if;
      -- Another Company's, or nobody's: the same answer as a Company that doesn't exist.
      if v_member_id is null or p_company_id is distinct from app.current_company_id() then
        return 'not_found';
      end if;
      -- One save at a time per Company.
      select c.id, c.authorized_person_id into v_company from company c where c.id = p_company_id for update;
      if v_company.authorized_person_id is distinct from v_member_id then
        return 'forbidden';
      end if;
      if not starts_with(p_storage_key, 'companies/' || p_company_id || '/' || p_kind || '/') or strpos(p_storage_key, '..') > 0 then
        raise exception 'A logo or Stamp image is stored under the Company''s own folder for it' using errcode = '22023';
      end if;
      insert into stored_file (storage_key, sha256, size, mime, uploaded_by_member_id, created_at)
      values (p_storage_key, p_sha256, p_size, p_mime, v_member_id, v_at)
      returning id into v_file_id;
      update company set
        logo_file_id = case when p_kind = 'logo' then v_file_id else logo_file_id end,
        stamp_file_id = case when p_kind = 'stamp' then v_file_id else stamp_file_id end,
        updated_at = v_at
      where id = p_company_id;
      return 'set';
    end
  $$;

grant execute on function app.active_signature_id(uuid) to rabaed_app;
grant execute on function app.member_company_has_stamp(uuid) to rabaed_app;
