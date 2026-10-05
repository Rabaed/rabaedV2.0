-- Security definer helpers in plpgsql, so they stop being planned again on every
-- call (RP-310; found in RP-299's seam-1 slowdown). PostgreSQL never inlines a
-- `language sql` function that is security definer or sets search_path, and
-- keeps no plan for it: each call, nested helpers included, plans its body from
-- scratch (up to PostgreSQL 17; Rabaed runs 16). A plpgsql function keeps its
-- plans for the session. In a rolled-back
-- benchmark, app.can_save_answers went from 24 ms to 0.8 ms and
-- app.work_item_actions from 32 ms to 1.2 ms.
--
-- Every function below is its latest version with the same body, arguments,
-- result, volatility, owner, security definer, settings (search_path, and
-- jit = off on app.work_item_answers) and grants (create or replace keeps owner
-- and grants). Behaviour and visibility are unchanged. Only the wrapping is new:
--
-- * A scalar body becomes `return (<body>);`. app.current_authorized_company_id
--   also gets `limit 1`: the sql version returned the first row, where a scalar
--   subquery would raise on two (nothing stops two Companies naming one
--   Authorized Person).
-- * A set-returning body becomes `return query <body>;`.
-- * A void body runs as it is (an update, or a delete and an insert).
-- * `#variable_conflict use_column`: in a sql function a name that is both a
--   column and a parameter (or an output column of `returns table`) means the
--   column. This keeps that reading; plpgsql's default would raise instead.
--
-- app.current_member_id stays plain sql: it is not security definer, sets
-- nothing, and so is inlined. The seam-2 test definer-language.test.ts fails on
-- any security definer function in app that is written in sql.
--
-- Re-created:
--  app.acting_project_member, app.answers_autosave, app.answers_held,
--  app.answers_open, app.can_change_documents, app.can_change_draft_documents,
--  app.can_change_links, app.can_create_revision, app.can_discard_revision,
--  app.code_signer_name, app.current_admin_project_ids,
--  app.current_authorized_company_id, app.current_company_id,
--  app.current_participant_ids, app.current_project_ids, app.documents_refusal,
--  app.engineer_sign_in_candidate, app.field_document_refusal,
--  app.form_participant_choices, app.holds_work_item, app.is_draft_step,
--  app.latest_draft_step, app.latest_form_version, app.locked_field_keys,
--  app.mark_notifications_read, app.member_grants, app.my_visibility,
--  app.participant_covered_values, app.participant_covers_item,
--  app.participant_grants, app.participant_scopes, app.participation,
--  app.pending_document_upload, app.principal_is_active,
--  app.project_host_company_name, app.project_invitations,
--  app.project_member_has_permission, app.project_participants,
--  app.replace_grant_values, app.revision_answers, app.revision_chain,
--  app.revision_document_copies, app.revision_dropped_fields,
--  app.revision_dropped_keys, app.revision_versions_changed, app.revoke_session,
--  app.sees_work_item, app.session_principal, app.sign_in_candidate,
--  app.step_as_seen, app.step_pool, app.takeable_transitions,
--  app.values_covered_by_grant, app.values_covered_by_participant,
--  app.values_covered_by_project_member, app.work_item_actions,
--  app.work_item_answers, app.work_item_chain_intact, app.work_item_companies,
--  app.work_item_linked_from, app.work_item_links, app.work_item_named_answers,
--  app.work_item_submitted.

create or replace function app.acting_project_member(p_work_item_id uuid) returns table(project_member_id uuid, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.id, pm.participant_id
        from work_item w
        join project_member pm on pm.project_id = w.project_id
        join participant p on p.id = pm.participant_id
        where w.id = p_work_item_id and app.sees_work_item(w.id)
          and pm.member_id = app.current_member_id() and pm.status = 'active'
          and p.status = 'active' and p.company_id = app.current_company_id();
    end
  $$;

create or replace function app.answers_autosave(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.can_save_answers(p_work_item_id)
          and exists (select 1 from work_item w where w.id = p_work_item_id and app.is_draft_step(w.current_step_id))
          and not exists (
            select 1 from work_item_event e
            where e.work_item_id = p_work_item_id and e.type = 'transition' and app.is_draft_step(e.from_step_id)
          )
      );
    end
  $$;

create or replace function app.answers_held(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1 from work_item w
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join workflow_step cur on cur.id = w.current_step_id
          join form_version v on v.id = w.form_version_id
          cross join lateral app.acting_project_member(w.id) me
          join step_assignment a on a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
            and a.participant_id = me.participant_id
          where w.id = p_work_item_id and w.closed_at is null
            and not app.is_draft_step(w.participant_entered_step_id)
            and me.participant_id <> w.raised_by_participant_id
            and exists (select 1 from jsonb_array_elements(v.schema -> 'sections') s where (s -> 'editable_at') ? cur.key)
        )
      );
    end
  $$;

create or replace function app.answers_open(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1 from work_item w
          join project pr on pr.id = w.project_id and pr.status = 'active'
          where w.id = p_work_item_id and w.closed_at is null and app.is_draft_step(w.participant_entered_step_id)
        )
      );
    end
  $$;

create or replace function app.can_change_documents(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.can_change_draft_documents(p_work_item_id) and exists (
          select 1 from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          cross join lateral app.acting_project_member(w.id) me
          where w.id = p_work_item_id
            and app.project_member_has_permission(me.project_member_id, t.module_key, 'attach')
        )
      );
    end
  $$;

create or replace function app.can_change_draft_documents(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.can_save_answers(p_work_item_id)
          and exists (select 1 from work_item w where w.id = p_work_item_id and app.is_draft_step(w.current_step_id))
      );
    end
  $$;

create or replace function app.can_change_links(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.can_save_answers(p_work_item_id) and exists (
          select 1 from work_item w
          cross join lateral app.acting_project_member(w.id) me
          where w.id = p_work_item_id and me.participant_id = w.raised_by_participant_id
        )
      );
    end
  $$;

create or replace function app.can_create_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1
          from work_item w
          join work_item_type t on t.id = w.work_item_type_id
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
          join participant p on p.id = me.participant_id
          join project_role r on r.id = p.project_role_id
          join app.latest_draft_step(w.work_item_type_id) d on true
          where w.id = p_work_item_id
            and w.outcome = 'C' and w.discarded_at is null
            and d.actor_rule ->> 'base_role' = r.base_role
            and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
            -- The latest of its chain, and nothing of the chain open.
            and not exists (
              select 1 from work_item o
              where o.root_id = w.root_id and o.discarded_at is null
                and (o.revision_no > w.revision_no or o.closed_at is null))
        )
      );
    end
  $$;

create or replace function app.can_discard_revision(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1
          from work_item w
          join project pr on pr.id = w.project_id and pr.status = 'active'
          join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
          where w.id = p_work_item_id and w.revision_no > 0
            and w.closed_at is null and w.document_number is null and app.is_draft_step(w.current_step_id)
        )
      );
    end
  $$;

create or replace function app.code_signer_name(p_event_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select m.full_name
        from work_item_event e
        join member m on m.id = e.actor_member_id
        where e.id = p_event_id and e.type = 'issue_code' and e.audience = 'shared' and e.payload ? 'outcome'
          and app.sees_work_item(e.work_item_id)
      );
    end
  $$;

create or replace function app.current_admin_project_ids() returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pa.project_id from project_admin pa
        where pa.member_id = app.current_member_id()
          and pa.project_id in (select app.current_project_ids());
    end
  $$;

create or replace function app.current_authorized_company_id() returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select co.id from company co join member m on m.id = co.authorized_person_id
        where m.id = app.current_member_id() and m.status = 'active' and co.status = 'active'
        limit 1
      );
    end
  $$;

create or replace function app.current_company_id() returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select company_id from member
        where id = app.current_member_id() and status = 'active'
      );
    end
  $$;

create or replace function app.current_participant_ids() returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id from participant p
        where p.status = 'active'
          and p.company_id = app.current_company_id()
          and (
            p.project_id in (select app.current_project_ids())
            or p.company_id = app.current_authorized_company_id()
          );
    end
  $$;

create or replace function app.current_project_ids() returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.project_id
        from project_member pm
        join participant p on p.id = pm.participant_id
        join member m on m.id = pm.member_id
        join company co on co.id = m.company_id
        where pm.member_id = app.current_member_id()
          and pm.status = 'active' and p.status = 'active'
          and p.company_id = m.company_id
          and m.status = 'active' and co.status = 'active';
    end
  $$;

create or replace function app.documents_refusal(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select case
          when exists (select 1 from work_item w join project pr on pr.id = w.project_id
            where w.id = p_work_item_id and pr.status <> 'active') then 'project_closed'
          when app.can_change_draft_documents(p_work_item_id) then 'forbidden'
          else 'not_editable'
        end
      );
    end
  $$;

create or replace function app.engineer_sign_in_candidate(p_email text) returns table(engineer_id uuid, password_hash text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select e.id, c.password_hash
        from rabaed_engineer e join credential c on c.engineer_id = e.id
        where e.email = lower(trim(p_email)) and e.status = 'active';
    end
  $$;

create or replace function app.field_document_refusal(p_work_item_id uuid, p_field_key text, p_content_type text, p_document_id uuid, p_item_key text default null) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        with field as (
          select f
          from work_item w
          join form_version v on v.id = w.form_version_id
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where w.id = p_work_item_id and f ->> 'key' = p_field_key
            and ((p_item_key is null and f ->> 'type' in ('attachments', 'photos')) or (p_item_key is not null and f ->> 'type' = 'checklist'))
        ),
        item as (
          select i
          from field cross join lateral jsonb_array_elements(f -> 'items') i
          where i ->> 'key' = p_item_key and coalesce(i ->> 'photo', 'off') <> 'off'
        )
        select case
          when not exists (select 1 from field) then 'field_not_found'
          when p_item_key is not null and not exists (select 1 from item) then 'field_not_found'
          when (p_item_key is not null or (select f ->> 'type' from field) = 'photos')
            and p_content_type <> all (array['image/jpeg', 'image/png', 'image/webp', 'image/heic']) then 'content_type_not_allowed'
          when p_item_key is null and (select f ? 'contentTypes' and not (f -> 'contentTypes') ? p_content_type from field)
            then 'content_type_not_allowed'
          when case when p_item_key is not null then 10 else (select (f ->> 'maxFiles')::integer from field) end <= (
            select count(*) from document d
            where d.work_item_id = p_work_item_id and d.field_key = p_field_key
              and d.item_key is not distinct from p_item_key
              and d.confirmed_at is not null and d.removed_at is null
              and d.id is distinct from p_document_id
          ) then 'too_many_files'
        end
      );
    end
  $$;

create or replace function app.form_participant_choices(p_project_id uuid, p_work_item_id uuid) returns table(participant_id uuid, legal_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id, co.legal_name
        from participant p
        join project pr on pr.id = p.project_id
        join company co on co.id = p.company_id
        where p.project_id = p_project_id and p.status = 'active'
          and p_project_id in (select app.current_project_ids())
          and (
            p.company_id = app.current_company_id()
            or p.company_id = pr.host_company_id
            or p.id in (
              select c.participant_id from work_item w
              cross join lateral app.work_item_companies(w.id) c
              where w.id = p_work_item_id and w.project_id = p_project_id
            )
          )
        order by p.company_id <> app.current_company_id(), p.created_at, p.id;
    end
  $$;

create or replace function app.holds_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from step_assignment a
          where a.work_item_id = p_work_item_id and a.status in ('pooled', 'claimed', 'vacant')
            and a.participant_id in (select app.current_participant_ids())
        )
      );
    end
  $$;

create or replace function app.is_draft_step(p_step_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from workflow_step s
          join workflow_version v on v.id = s.workflow_version_id
          join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
          join stage st on st.owner_kind = 'rabaed' and st.module_key = t.module_key and st.key = s.stage_key
          where s.id = p_step_id and st.category = 'draft'
        )
      );
    end
  $$;

create or replace function app.latest_draft_step(p_work_item_type_id uuid) returns table(step_id uuid, workflow_version_id uuid, stage_key text, actor_rule jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.workflow_version_id, s.stage_key, s.actor_rule
        from work_item_type t
        join lateral (
          select v.id from workflow_version v
          where v.workflow_definition_id = t.workflow_definition_id and v.status = 'published'
          order by v.version_no desc limit 1
        ) v on true
        join workflow_step s on s.workflow_version_id = v.id
        where t.id = p_work_item_type_id and app.is_draft_step(s.id);
    end
  $$;

create or replace function app.latest_form_version(p_type_code text) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select v.id from form_version v
        join work_item_type t on t.form_definition_id = v.form_definition_id
        where t.owner_kind = 'rabaed' and t.code = p_type_code and v.status = 'published'
        order by v.version_no desc limit 1
      );
    end
  $$;

create or replace function app.locked_field_keys(p_work_item_id uuid) returns text[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(array_agg(f ->> 'key'), '{}')
        from work_item w
        join form_version v on v.id = w.form_version_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where w.id = p_work_item_id and f ->> 'type' <> 'calculated'
          and (s ->> 'key') not in (select app.editable_section_keys(p_work_item_id))
      );
    end
  $$;

create or replace function app.mark_notifications_read(p_ids uuid[], p_now timestamp with time zone) returns void
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      update notification set read_at = greatest(p_now, now())
      where member_id = app.current_member_id() and read_at is null and (p_ids is null or id = any (p_ids));
    end
  $$;

create or replace function app.member_grants(p_participant_id uuid, p_member_id uuid) returns table(kind text, is_all boolean, value_ids uuid[])
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, coalesce(g.is_all, false),
          array(select gv.dimension_value_id from visibility_grant_value gv where gv.grant_id = g.id order by 1)
        from project_member pm
        join visibility_dimension d on d.project_id = pm.project_id
        left join visibility_grant g on g.project_member_id = pm.id and g.dimension_id = d.id
        where pm.participant_id = p_participant_id and pm.member_id = p_member_id and pm.status = 'active'
          and p_participant_id in (select app.current_participant_ids())
        order by d.kind;
    end
  $$;

create or replace function app.my_visibility(p_project_id uuid) returns table(kind text, value_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, c.id
        from project_member pm
        join visibility_dimension d on d.project_id = pm.project_id
        cross join lateral app.values_covered_by_project_member(pm.id, d.id) as c (id)
        where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
          and p_project_id in (select app.current_project_ids());
    end
  $$;

create or replace function app.participant_covered_values(p_participant_id uuid) returns table(kind text, id uuid, parent_id uuid, depth smallint, code text, name jsonb, level_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, v.id, v.parent_id, v.depth, v.code, v.name, v.level_name
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join dimension_value v on v.id = c.id
        where p.id = p_participant_id and p.status = 'active'
          and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
        order by d.kind, v.depth, v.sort, v.id;
    end
  $$;

create or replace function app.participant_covers_item(p_participant_id uuid, p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select not exists (
          select 1 from work_item_dimension_value dv
          where dv.work_item_id = p_work_item_id
            and dv.dimension_value_id not in (select app.values_covered_by_participant(p_participant_id, dv.dimension_id))
        )
      );
    end
  $$;

create or replace function app.participant_grants(p_participant_id uuid) returns table(kind text, is_all boolean, value_ids uuid[])
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.kind, coalesce(g.is_all, false),
          array(select gv.dimension_value_id from visibility_grant_value gv where gv.grant_id = g.id order by 1)
        from participant p
        join visibility_dimension d on d.project_id = p.project_id
        left join visibility_grant g on g.participant_id = p.id and g.project_member_id is null and g.dimension_id = d.id
        where p.id = p_participant_id and p.status = 'active'
          and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
        order by d.kind;
    end
  $$;

create or replace function app.participant_scopes(p_participant_id uuid) returns table(id uuid, trade_value_id uuid, parent_id uuid, depth smallint, name jsonb, status text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.trade_value_id, s.parent_id, s.depth, s.name, s.status
        from participant p
        join visibility_dimension d on d.project_id = p.project_id and d.kind = 'trade'
        cross join lateral app.values_covered_by_participant(p.id, d.id) as c (id)
        join scope s on s.trade_value_id = c.id
        join dimension_value t on t.id = s.trade_value_id
        left join scope parent on parent.id = s.parent_id
        where p.id = p_participant_id and p.status = 'active'
          and (p.id in (select app.current_participant_ids()) or p.project_id in (select app.current_admin_project_ids()))
        -- As the Project's list (apps/api listScopes): by Trade, each Scope followed by its Sub-scopes.
        order by t.sort, t.id, coalesce(parent.sort, s.sort), coalesce(s.parent_id, s.id), s.depth, s.sort;
    end
  $$;

create or replace function app.participation(p_participant_id uuid) returns table(participant_id uuid, project_id uuid, project_number integer, code text, name jsonb, base_role text, role_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id, pr.id, pr.project_number, pr.code, pr.name, r.base_role, r.name
        from participant p
        join project pr on pr.id = p.project_id
        join project_role r on r.id = p.project_role_id
        where p.id = p_participant_id and p.id in (select app.current_participant_ids());
    end
  $$;

create or replace function app.pending_document_upload(p_work_item_id uuid, p_document_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select d.storage_key from document d
        where d.id = p_document_id and d.work_item_id = p_work_item_id
          and d.uploaded_by_member_id = app.current_member_id()
          and d.confirmed_at is null and d.removed_at is null
          and app.sees_work_item(p_work_item_id)
      );
    end
  $$;

create or replace function app.principal_is_active(p_member_id uuid, p_engineer_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from member m join company co on co.id = m.company_id
          where m.id = p_member_id and m.status = 'active' and co.status = 'active'
        ) or exists (
          select 1 from rabaed_engineer e where e.id = p_engineer_id and e.status = 'active'
        )
      );
    end
  $$;

create or replace function app.project_host_company_name(p_project_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select co.legal_name
        from project pr
        join company co on co.id = pr.host_company_id
        where pr.id = p_project_id
          and exists (
            select 1 from participant p
            where p.project_id = pr.id and p.id in (select app.current_participant_ids())
          )
      );
    end
  $$;

create or replace function app.project_invitations(p_project_id uuid) returns table(invitation_id uuid, cr_number text, base_role text, role_name jsonb, invited_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select x.id, x.cr_number, r.base_role, r.name, x.at
        from (
          select p.id, co.cr_number, p.project_role_id, p.invited_at as at
          from participant p join company co on co.id = p.company_id
          where p.project_id = p_project_id and p.status in ('invited', 'declined')
          union all
          select l.id, l.cr_number, l.project_role_id, l.updated_at
          from onboarding_lead l
          where l.project_id = p_project_id and l.converted_at is null and l.withdrawn_at is null
            -- A lead written while its Company was being onboarded: once that Company
            -- is invited, the invitation alone is listed.
            and not exists (
              select 1 from participant p join company co on co.id = p.company_id
              where p.project_id = l.project_id and co.cr_number = l.cr_number
            )
        ) x
        join project_role r on r.id = x.project_role_id
        where p_project_id in (select app.current_admin_project_ids())
        order by x.at desc, x.id desc;
    end
  $$;

create or replace function app.project_member_has_permission(p_project_member_id uuid, p_module_key text, p_permission text) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from project_member_position mp
          join position_permission pp on pp.position_id = mp.position_id
          where mp.project_member_id = p_project_member_id
            and pp.module_key = p_module_key and pp.permission = p_permission
        )
      );
    end
  $$;

create or replace function app.project_participants(p_project_id uuid) returns table(participant_id uuid, company_id uuid, legal_name jsonb, base_role text, role_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id, co.id, co.legal_name, r.base_role, r.name
        from participant p
        join company co on co.id = p.company_id
        join project_role r on r.id = p.project_role_id
        where p.project_id = p_project_id and p.status = 'active'
          and p_project_id in (select app.current_project_ids())
          and (
            p.company_id = app.current_company_id()
            or p_project_id in (select app.current_admin_project_ids())
          )
        order by p.created_at, p.id;
    end
  $$;

create or replace function app.replace_grant_values(p_grant_id uuid, p_value_ids uuid[]) returns void
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      delete from visibility_grant_value where grant_id = p_grant_id;
      insert into visibility_grant_value (grant_id, project_id, dimension_id, dimension_value_id)
      select g.id, g.project_id, g.dimension_id, v.id
      from visibility_grant g cross join (select distinct unnest(p_value_ids) as id) v
      where g.id = p_grant_id and not g.is_all;
    end
  $$;

create or replace function app.revision_answers(p_closed_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.work_item_full_answers(w.id) - app.revision_dropped_keys(w.id)
        from work_item w where w.id = p_closed_item_id
      );
    end
  $$;

create or replace function app.revision_chain(p_work_item_id uuid) returns table(work_item_id uuid, document_number text, revision_no integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select o.id, o.document_number, o.revision_no
        from work_item w
        join work_item o on o.root_id = w.root_id and o.project_id = w.project_id
        where w.id = p_work_item_id and app.sees_work_item(w.id)
          and o.discarded_at is null and app.sees_work_item(o.id)
        order by o.revision_no;
    end
  $$;

create or replace function app.revision_document_copies(p_work_item_id uuid) returns table(storage_key text, source_storage_key text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select d.storage_key, s.storage_key
        from document d
        join document_copy c on c.document_id = d.id
        join document s on s.id = c.copied_from_id
        where d.work_item_id = p_work_item_id and d.frozen_at is null and d.removed_at is null
          and app.can_change_documents(p_work_item_id)
        order by d.id;
    end
  $$;

create or replace function app.revision_dropped_fields(p_work_item_id uuid) returns table(field_key text, label jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select f ->> 'key', f -> 'label'
        from work_item w
        join work_item prev on prev.id = w.revision_of_id
        join form_version v on v.id = prev.form_version_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') with ordinality s (s, sn)
        cross join lateral jsonb_array_elements(s -> 'fields') with ordinality f (f, fn)
        where w.id = p_work_item_id and app.sees_work_item(w.id)
          and w.form_version_id <> prev.form_version_id
          and f ->> 'type' not in ('heading', 'instructions', 'divider')
          and app.form_field_type(w.form_version_id, f ->> 'key') is distinct from f ->> 'type'
        order by sn, fn;
    end
  $$;

create or replace function app.revision_dropped_keys(p_work_item_id uuid) returns text[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(array_agg(f ->> 'key'), '{}')
        from work_item w
        join form_version v on v.id = w.form_version_id
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where w.id = p_work_item_id and s ? 'editable_at'
          and (
            select h.actor_rule ->> 'base_role' from workflow_step h
            where h.workflow_version_id = w.workflow_version_id and h.key = s -> 'editable_at' ->> 0
          ) is distinct from (
            select d.actor_rule ->> 'base_role' from workflow_step d
            where d.workflow_version_id = w.workflow_version_id and app.is_draft_step(d.id)
            limit 1)
      );
    end
  $$;

create or replace function app.revision_versions_changed(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce((
          select w.form_version_id <> prev.form_version_id or w.workflow_version_id <> prev.workflow_version_id
          from work_item w join work_item prev on prev.id = w.revision_of_id
          where w.id = p_work_item_id and app.sees_work_item(w.id)
        ), false)
      );
    end
  $$;

create or replace function app.revoke_session(p_token_hash bytea, p_now timestamp with time zone) returns void
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      update session set revoked_at = greatest(p_now, now())
      where token_hash = p_token_hash and revoked_at is null;
    end
  $$;

create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          where w.id = p_work_item_id
            and w.project_id in (select app.current_project_ids())
            and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id()
            and (p.id = w.raised_by_participant_id or s.actor_rule ->> 'base_role' is distinct from raiser_role.base_role)
            and not exists (
              select 1 from work_item_dimension_value dv
              where dv.work_item_id = w.id
                and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
            )
        )
      );
    end
  $$;

create or replace function app.session_principal(p_token_hash bytea, p_now timestamp with time zone) returns table(session_id uuid, member_id uuid, engineer_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.member_id, null::uuid
        from session s
        where s.token_hash = p_token_hash
          and s.member_id is not null
          and s.revoked_at is null
          and s.expires_at > greatest(p_now, now())
          and app.principal_is_active(s.member_id, null);
    end
  $$;

create or replace function app.sign_in_candidate(p_kind text, p_email text) returns table(principal_id uuid, password_hash text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select m.id, c.password_hash
        from member m join credential c on c.member_id = m.id
        join company co on co.id = m.company_id
        where p_kind = 'member' and m.email = lower(trim(p_email))
          and m.status = 'active' and co.status = 'active';
    end
  $$;

create or replace function app.step_as_seen(p_work_item_id uuid) returns table(step_id uuid, stage_key text, entered_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select s.id, s.stage_key, case when h.mine then w.step_entered_at else w.participant_entered_at end
        from work_item w
        cross join lateral (
          select exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'claimed', 'vacant')
              and a.participant_id in (select app.current_participant_ids())
          ) as mine
        ) h
        join workflow_step s on s.id = case when h.mine then w.current_step_id else w.participant_entered_step_id end
        where w.id = p_work_item_id and app.sees_work_item(w.id);
    end
  $$;

create or replace function app.step_pool(p_work_item_id uuid, p_step_id uuid, p_participant_id uuid) returns table(project_member_id uuid, member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select pm.id, pm.member_id
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        join workflow_step s on s.id = p_step_id and s.workflow_version_id = w.workflow_version_id
        join participant p on p.id = p_participant_id and p.project_id = w.project_id and p.status = 'active'
        join project_member pm on pm.participant_id = p.id and pm.status = 'active'
        join member m on m.id = pm.member_id and m.status = 'active' and m.company_id = p.company_id
        join company co on co.id = m.company_id and co.status = 'active'
        where w.id = p_work_item_id
          and app.project_member_has_permission(pm.id, t.module_key, s.actor_rule ->> 'permission')
          and not exists (
            select 1 from work_item_dimension_value dv
            where dv.work_item_id = w.id
              and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
          );
    end
  $$;

create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select tr.id, tr.key, tr.label, tr.kind, tr.sort
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
        where w.id = p_work_item_id and w.closed_at is null
          and app.project_member_has_permission(me.project_member_id, t.module_key, tr.permission)
          and (select h.outcome from app.next_step_holder(w.id, tr.id) h) in ('ok', 'terminal');
    end
  $$;

create or replace function app.values_covered_by_grant(p_grant_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        with recursive g as (
          select id, dimension_id, is_all from visibility_grant where id = p_grant_id
        ), covered (id) as (
          select v.id from dimension_value v join g on v.dimension_id = g.dimension_id where g.is_all
          union
          select gv.dimension_value_id from visibility_grant_value gv join g on gv.grant_id = g.id where not g.is_all
          union
          select v.id from dimension_value v join covered c on v.parent_id = c.id
        )
        select id from covered;
    end
  $$;

create or replace function app.values_covered_by_participant(p_participant_id uuid, p_dimension_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select c.id from visibility_grant g cross join lateral app.values_covered_by_grant(g.id) as c (id)
        where g.participant_id = p_participant_id and g.project_member_id is null and g.dimension_id = p_dimension_id;
    end
  $$;

create or replace function app.values_covered_by_project_member(p_project_member_id uuid, p_dimension_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select c.id from visibility_grant g cross join lateral app.values_covered_by_grant(g.id) as c (id)
        where g.project_member_id = p_project_member_id and g.dimension_id = p_dimension_id
        intersect
        select c.id from project_member pm cross join lateral app.values_covered_by_participant(pm.participant_id, p_dimension_id) as c (id)
        where pm.id = p_project_member_id;
    end
  $$;

create or replace function app.work_item_actions(p_work_item_id uuid) returns table(action text, transition_key text, label jsonb, transition_kind text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select 'claim', null::text, null::jsonb, null::text
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'pooled' and a.participant_id = me.participant_id
        where w.id = p_work_item_id and w.closed_at is null
          and me.project_member_id in (select project_member_id from app.step_pool(w.id, a.step_id, a.participant_id))
        union all
        select 'release', null, null, null
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id()
        where w.id = p_work_item_id and w.closed_at is null and not app.is_draft_step(a.step_id)
        union all
        select * from (
          select 'transition', t.key, t.label, t.kind from app.takeable_transitions(p_work_item_id) t order by t.sort
        ) x;
    end
  $$;

create or replace function app.work_item_answers(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  set jit = off
  as $$
    #variable_conflict use_column
    begin
      return (
        select (a.src - array(
          select f ->> 'key'
          from form_version v
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where v.id = w.form_version_id
            and f ->> 'type' in ('member', 'participant')
            and a.src ? (f ->> 'key')
            and not case f ->> 'type'
              when 'member' then exists (
                select 1 from member m
                where m.id::text = a.src ->> (f ->> 'key') and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
                  and m.company_id = app.current_company_id())
              when 'participant' then exists (
                select 1 from participant p
                join project pr on pr.id = p.project_id
                where p.id::text = a.src ->> (f ->> 'key') and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
                  and p.project_id = w.project_id
                  and (p.company_id = app.current_company_id() or p.company_id = pr.host_company_id
                    or p.id in (select c.participant_id from app.work_item_companies(w.id) c)))
            end
        ) - array(select app.link_question_keys(w.form_version_id)))
        || coalesce((
          select jsonb_object_agg(k, app.link_choices_as_seen(w.id, w.project_id, a.src -> k))
          from app.link_question_keys(w.form_version_id) k
          where jsonb_typeof(a.src -> k) = 'array'
        ), '{}')
        from work_item w
        cross join lateral (select app.work_item_answers_unstripped(w.id) as src) a
        where w.id = p_work_item_id and app.sees_work_item(w.id)
      );
    end
  $$;

create or replace function app.work_item_chain_intact(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select coalesce(bool_and(ok), true) from (
          select e.seq = row_number() over w
            and e.hash = app.work_item_event_hash(e)
            and e.prev_hash is not distinct from lag(e.hash) over w as ok
          from work_item_event e
          where e.work_item_id = p_work_item_id
          window w as (order by e.seq)
        ) x
      );
    end
  $$;

create or replace function app.work_item_companies(p_work_item_id uuid) returns table(participant_id uuid, legal_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select p.id, co.legal_name
        from participant p
        join company co on co.id = p.company_id
        where app.sees_work_item(p_work_item_id)
          and p.id in (
            select w.raised_by_participant_id from work_item w where w.id = p_work_item_id
            union
            select a.participant_id from step_assignment a where a.work_item_id = p_work_item_id
            union
            select e.actor_participant_id from work_item_event e
            where e.work_item_id = p_work_item_id
              and (e.audience = 'shared' or e.audience_participant_id in (select app.current_participant_ids()))
          );
    end
  $$;

create or replace function app.work_item_linked_from(p_work_item_id uuid) returns table(document_number text, subject text, work_item_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select f.document_number, f.title, case when app.sees_work_item(f.id) then f.id end
        from work_item f
        where f.id in (select l.from_id from work_item_link l where l.to_id = p_work_item_id)
          and not app.is_draft_step(f.participant_entered_step_id)
          and f.discarded_at is null
          and app.sees_work_item(p_work_item_id)
          and not app.chain_item_hidden(p_work_item_id, f.id)
        order by f.document_number, f.id;
    end
  $$;

create or replace function app.work_item_links(p_work_item_id uuid) returns table(id uuid, kind text, field_key text, document_number text, subject text, work_item_id uuid, created_at timestamp with time zone)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title,
          case when app.sees_work_item(t.id) then t.id end, l.created_at
        from work_item_link l
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(p_work_item_id)
          and not app.chain_item_hidden(p_work_item_id, t.id)
        order by l.created_at, l.id;
    end
  $$;

create or replace function app.work_item_named_answers(p_work_item_id uuid) returns table(field_key text, field_type text, company_name jsonb, member_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        with answer as (
          select f ->> 'key' as field_key, f ->> 'type' as field_type, a.src ->> (f ->> 'key') as value, w.project_id
          from work_item w
          cross join lateral (select app.work_item_answers_unstripped(w.id) as src) a
          join form_version v on v.id = w.form_version_id
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where w.id = p_work_item_id and app.sees_work_item(p_work_item_id)
            and f ->> 'type' in ('member', 'participant')
            and jsonb_typeof(a.src -> (f ->> 'key')) = 'string'
        ),
        named as (
          -- The Participant each answer names: itself, or the Member's Company's on the Project.
          select a.field_key, a.field_type, a.project_id, p.id as participant_id, p.company_id, m.full_name
          from answer a
          left join member m on a.field_type = 'member' and m.id::text = a.value
          left join participant p on p.project_id = a.project_id and (
            (a.field_type = 'participant' and p.id::text = a.value)
            or (a.field_type = 'member' and p.company_id = m.company_id)
          )
        )
        select n.field_key, n.field_type,
          case when n.company_id = app.current_company_id()
            or n.company_id = (select pr.host_company_id from project pr where pr.id = n.project_id)
            or n.participant_id in (select c.participant_id from app.work_item_companies(p_work_item_id) c)
          then co.legal_name end,
          case when n.field_type = 'member' and n.company_id = app.current_company_id() then n.full_name end
        from named n
        left join company co on co.id = n.company_id;
    end
  $$;

create or replace function app.work_item_submitted(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select app.sees_work_item(p_work_item_id) and exists (
          select 1 from work_item w
          where w.id = p_work_item_id and not app.is_draft_step(w.participant_entered_step_id)
        )
      );
    end
  $$;
