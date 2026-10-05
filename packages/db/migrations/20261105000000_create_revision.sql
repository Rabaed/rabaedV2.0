-- Revisions: create one after Code C, discard a Draft one, and its Rev number
-- (RP-316, spec RP-311; workflow-engine.md §5.4 and §8, GLOSSARY "Revision",
-- visibility.md the Revisions channel, V1, scenarios 49, 51 and 56; RP-305 for
-- the answers, through app.fill_revision).
--
-- * work_item gains the chain: revision_no (0 = the original), revision_of_id (the
--   item it revises) and root_id (the original; an original's own id, set on
--   insert). One Revision number per chain, discarded ones aside. The app role
--   reads revision_no only: the ids would name an earlier Revision to someone who
--   may see a later one but not it (an Owner Representative whose Visibility
--   widened, V2). discarded_at marks a discarded Draft Revision.
-- * document_copy: which Document a Revision's copy was made from, so the api
--   copies the file (its storage key names the item, ADR 0007). Never granted:
--   the document table is the app role's whole, and another item's Document id
--   must not reach a reader of the copy. Read through app.revision_document_copies.
-- * app.can_create_revision(item): the item is the latest of its chain, closed
--   with Code C (or failed), no Revision of the chain is open, and the acting
--   Member is an active Member of the raiser's Participant whom the latest
--   published Workflow Version's Draft Step allows (its role and permission).
-- * app.create_revision(item, key, now): a new Work Item at Draft, pinned to the
--   latest published Form and Workflow Versions, with the answers app.fill_revision
--   gives it (the raiser's, never another Participant's sections) and the
--   Documents copied as new unfrozen rows. Like any new item it is the raiser's
--   only (V1) until Submitted. The chain's original row is locked, so two requests
--   never open two Revisions. Outcomes: 'created' (with its id), 'applied' (the
--   same key again: the same id, nothing done), 'not_found' (hidden or made up),
--   'project_closed', 'idempotency_key_reused', 'revision_not_allowed' (any other
--   reason, alike, so nobody outside the raiser learns whether a Draft Revision
--   is open).
-- * app.discard_revision(item, now): a Revision that never left Draft (no
--   Document Number yet), by an active Member of the raiser's Participant. It is
--   closed as cancelled, marked discarded, its assignment done and its access
--   rows removed, so nobody sees it again; its revision_no is free for the next
--   Revision. Outcomes: 'discarded', 'not_found', 'project_closed',
--   'not_discardable'.
-- * app.take_transition: as the numbering_after_answer_speed migration left it,
--   except (RP-316) that a Revision's first exit from Draft takes the chain's base
--   number with " Rev n" and no counter, and its first Submit gives the item it
--   revises the `related` Link to it. Not before: the closed item's Links are
--   read by everyone who sees it, and a Draft Revision must not reach them (V1,
--   scenario 51).
-- * app.fill_revision: as the review_fixes migration left it, keeping only the
--   answers whose field the Revision's Form Version has with the same type (a
--   newer Version may have dropped or changed one; form-engine.md §7). Now only
--   app.create_revision calls it.

-- The chain -------------------------------------------------------------------------

alter table work_item
  add column revision_no integer not null default 0 check (revision_no >= 0),
  add column revision_of_id uuid,
  add column root_id uuid,
  add column discarded_at timestamptz;
update work_item set root_id = id;
alter table work_item
  alter column root_id set not null,
  add constraint work_item_revision_of_fk foreign key (revision_of_id, project_id) references work_item (id, project_id),
  add constraint work_item_root_fk foreign key (root_id, project_id) references work_item (id, project_id),
  add constraint work_item_revision_chain check ((revision_no = 0) = (revision_of_id is null)),
  add constraint work_item_discarded_closed check (discarded_at is null or (closed_at is not null and revision_no > 0));
create unique index work_item_revision_no_key on work_item (root_id, revision_no) where discarded_at is null;

-- An original is its own chain's root.
create function app.set_work_item_root() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      new.root_id := coalesce(new.root_id, new.id);
      return new;
    end
  $$;
create trigger work_item_root before insert on work_item
  for each row execute function app.set_work_item_root();

-- work_item is granted column by column (step_age_by_holder migration).
grant select (revision_no) on work_item to rabaed_app;

create table document_copy (
  document_id uuid primary key references document (id),
  copied_from_id uuid not null references document (id)
);
-- Never the app role's: read through app.revision_document_copies.
alter table document_copy enable row level security;
revoke all on document_copy from rabaed_app;

-- Who may create one ------------------------------------------------------------------

-- The Draft Step of the latest published Version of an item's Type's Workflow:
-- where a new item, and so a Revision, starts.
create function app.latest_draft_step(p_work_item_type_id uuid)
  returns table (step_id uuid, workflow_version_id uuid, stage_key text, actor_rule jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select s.id, s.workflow_version_id, s.stage_key, s.actor_rule
    from work_item_type t
    join lateral (
      select v.id from workflow_version v
      where v.workflow_definition_id = t.workflow_definition_id and v.status = 'published'
      order by v.version_no desc limit 1
    ) v on true
    join workflow_step s on s.workflow_version_id = v.id
    where t.id = p_work_item_type_id and app.is_draft_step(s.id)
  $$;

create function app.can_create_revision(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
        and w.outcome in ('C', 'failed') and w.discarded_at is null
        and d.actor_rule ->> 'base_role' = r.base_role
        and app.project_member_has_permission(me.project_member_id, t.module_key, d.actor_rule ->> 'permission')
        -- The latest of its chain, and nothing of the chain open.
        and not exists (
          select 1 from work_item o
          where o.root_id = w.root_id and o.discarded_at is null
            and (o.revision_no > w.revision_no or o.closed_at is null))
    )
  $$;

create function app.can_discard_revision(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.sees_work_item(p_work_item_id) and exists (
      select 1
      from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      join app.acting_project_member(w.id) me on me.participant_id = w.raised_by_participant_id
      where w.id = p_work_item_id and w.revision_no > 0
        and w.closed_at is null and w.document_number is null and app.is_draft_step(w.current_step_id)
    )
  $$;

-- Whether a visible Revision is pinned to a Form or Workflow Version other than the
-- item it revises: the item page then shows a notice. Never the ids themselves.
create function app.revision_versions_changed(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select coalesce((
      select w.form_version_id <> prev.form_version_id or w.workflow_version_id <> prev.workflow_version_id
      from work_item w join work_item prev on prev.id = w.revision_of_id
      where w.id = p_work_item_id and app.sees_work_item(w.id)
    ), false)
  $$;

-- The answers a Revision starts with --------------------------------------------------

create or replace function app.fill_revision(p_revision_id uuid, p_closed_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_closed record;
      v_revision record;
      v_answers jsonb;
      v_scopes uuid[];
    begin
      if not app.sees_work_item(p_closed_item_id) or not app.sees_work_item(p_revision_id) then
        return 'not_found';
      end if;
      select * into v_closed from work_item where id = p_closed_item_id;
      select * into v_revision from work_item where id = p_revision_id for update;
      if coalesce(v_closed.outcome, '') not in ('C', 'failed')
        or p_revision_id = p_closed_item_id
        or v_closed.raised_by_participant_id not in (select app.current_participant_ids())
        or v_revision.raised_by_participant_id <> v_closed.raised_by_participant_id
        or v_revision.project_id <> v_closed.project_id
        or v_revision.work_item_type_id <> v_closed.work_item_type_id
        or v_revision.closed_at is not null
        or not app.is_draft_step(v_revision.current_step_id)
        or exists (select 1 from work_item_event e where e.work_item_id = p_revision_id and e.type = 'transition')
        or not app.can_save_answers(p_revision_id)
      then
        return 'not_allowed';
      end if;

      v_answers := app.revision_answers(p_closed_item_id) - app.revision_dropped_keys(p_revision_id);
      -- RP-316: only the answers the Revision's Form Version still has, with the same
      -- type; the Built-in Fields are in every Form.
      v_answers := coalesce((
        select jsonb_object_agg(a.key, a.value) from jsonb_each(v_answers) a
        where a.key in ('trade', 'location', 'scopes')
          or app.form_field_type(v_revision.form_version_id, a.key) = app.form_field_type(v_closed.form_version_id, a.key)
      ), '{}'::jsonb);
      v_scopes := array(select x::uuid from jsonb_array_elements_text(coalesce(v_answers -> 'scopes', '[]')) x);
      perform app.set_work_item_built_ins(
        p_revision_id, v_revision.project_id,
        (v_answers ->> 'trade')::uuid, (v_answers ->> 'location')::uuid, v_scopes);
      update work_item set
        data = v_answers - array['trade', 'location', 'scopes'],
        data_as_arrived = null,
        field_times = '{}'::jsonb,
        field_times_as_arrived = null,
        updated_at = v_at
      where id = p_revision_id;
      perform app.sync_link_answers(
        p_revision_id, v_revision.project_id, v_revision.form_version_id, v_answers - array['trade', 'location', 'scopes'], v_at);
      perform app.record_field_times(p_revision_id, p_now);
      return 'filled';
    end
  $$;

-- The type of a Form Version's field, or null when it has none by that key.
create function app.form_field_type(p_form_version_id uuid, p_key text) returns text
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select f ->> 'type'
    from form_version v
    cross join lateral jsonb_array_elements(v.schema -> 'sections') s
    cross join lateral jsonb_array_elements(s -> 'fields') f
    where v.id = p_form_version_id and f ->> 'key' = p_key
    limit 1
  $$;

-- Creating one ----------------------------------------------------------------------

create function app.create_revision(p_work_item_id uuid, p_idempotency_key uuid, p_now timestamptz)
  returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_draft record;
      v_form_version_id uuid;
      v_id uuid;
      v_kept text[];
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      -- The chain's original, locked: one Revision of a chain at a time.
      perform 1 from work_item r
      where r.id = (select w.root_id from work_item w where w.id = p_work_item_id)
      for update;
      select w.*, t.code as type_code, pr.status as project_status into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;

      select c.work_item_id, c.command into v_used from command_idempotency c
      where c.member_id = v_member_id and c.key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return query select
          case when v_used.command = 'create_revision:' || p_work_item_id then 'applied' else 'idempotency_key_reused' end,
          case when v_used.command = 'create_revision:' || p_work_item_id then v_used.work_item_id end;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if not app.can_create_revision(p_work_item_id) then
        return query select 'revision_not_allowed'::text, null::uuid;
        return;
      end if;

      select * into v_draft from app.latest_draft_step(v_item.work_item_type_id);
      v_form_version_id := app.latest_form_version(v_item.type_code);
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        revision_no, revision_of_id, root_id, created_at, updated_at
      ) values (
        v_item.project_id, v_item.work_item_type_id, v_item.raised_by_participant_id, v_member_id, v_item.title, '{}',
        v_draft.workflow_version_id, v_form_version_id, v_draft.step_id, v_draft.stage_key, v_at,
        v_item.revision_no + 1, v_item.id, v_item.root_id, v_at, v_at
      ) returning id into v_id;

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_item.project_id, v_item.raised_by_participant_id, v_at, 'raised');
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (v_item.project_id, v_id, v_draft.step_id, v_item.raised_by_participant_id, v_member_id, 'claimed', v_at, v_at);
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, v_id, 'created', v_member_id, v_item.raised_by_participant_id, v_draft.step_id,
        jsonb_build_object('title', v_item.title, 'revision_no', v_item.revision_no + 1),
        'internal', v_item.raised_by_participant_id, v_at
      );

      -- The answers (RP-305: never another Participant's sections).
      if app.fill_revision(v_id, p_work_item_id, v_at) <> 'filled' then
        raise exception 'fill_revision refused a new Revision';
      end if;

      -- The Documents, as new unfrozen rows: of the Attachments System Field, and of
      -- the fields the Revision still has.
      v_kept := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id
          and app.form_field_type(v_item.form_version_id, f ->> 'key') = f ->> 'type'
        except select unnest(app.revision_dropped_keys(v_id)));
      with source as materialized (
        select app.uuid_v7() as new_id, d.*
        from (
          select d.* from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and (d.field_key is null or d.field_key = any (v_kept))
          order by d.confirmed_at, d.id
        ) d
      ), copied as (
        insert into document (
          id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
          uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at,
          field_key, item_key, taken_at, taken_latitude, taken_longitude
        )
        select s.new_id, s.project_id, v_id, s.file_name, s.size_bytes, s.content_type,
          app.document_storage_key(s.project_id, v_id, s.new_id),
          s.uploaded_by_member_id, s.uploaded_by_participant_id, v_at, v_at,
          s.field_key, s.item_key, s.taken_at, s.taken_latitude, s.taken_longitude
        from source s
        returning document.id
      )
      insert into document_copy (document_id, copied_from_id)
      select s.new_id, s.id from source s join copied c on c.id = s.new_id;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, v_id, 'create_revision:' || p_work_item_id, v_at);
      return query select 'created'::text, v_id;
    end
  $$;

-- A new Revision's copied Documents, each with the storage key of the file it was
-- copied from, for the api to copy the files (in the same transaction). Only for
-- a Member who may still change its Documents.
create function app.revision_document_copies(p_work_item_id uuid)
  returns table (storage_key text, source_storage_key text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select d.storage_key, s.storage_key
    from document d
    join document_copy c on c.document_id = d.id
    join document s on s.id = c.copied_from_id
    where d.work_item_id = p_work_item_id and d.frozen_at is null and d.removed_at is null
      and app.can_change_documents(p_work_item_id)
    order by d.id
  $$;

-- Discarding one ----------------------------------------------------------------------

create function app.discard_revision(p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.*, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      if not app.can_discard_revision(p_work_item_id) then
        return 'not_discardable';
      end if;

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, from_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'cancelled', app.current_member_id(), v_me.participant_id, v_item.current_step_id,
        jsonb_build_object('revision_discarded', true), 'internal', v_item.raised_by_participant_id, v_at
      );
      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      update work_item set outcome = 'cancelled', closed_at = v_at, discarded_at = v_at, updated_at = v_at
      where id = p_work_item_id;
      -- Nobody sees it again; it never left the raiser's Participant.
      delete from work_item_access where work_item_id = p_work_item_id;
      return 'discarded';
    end
  $$;

-- Taking a Transition -----------------------------------------------------------------

create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_member_id uuid := app.current_member_id();
      v_item record;
      v_me record;
      v_used record;
      v_assignment record;
      v_transition record;
      v_next record;
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
      v_discarded text[];
      v_data jsonb;
      v_times jsonb;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, t.code as type_code, pr.status as project_status, pr.code as project_code
      into v_item
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;

      select work_item_id, command into v_used from command_idempotency
      where member_id = v_member_id and key = p_idempotency_key;
      if v_used.work_item_id is not null then
        return case when v_used.work_item_id = p_work_item_id and v_used.command = 'transition:' || p_transition_key
          then 'applied' else 'idempotency_key_reused' end;
      end if;

      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      if v_assignment.status is distinct from 'claimed' or v_assignment.assignee_member_id <> v_member_id
        or v_assignment.participant_id <> v_me.participant_id
      then
        return 'not_holder';
      end if;

      select tr.*, target.stage_key as to_stage_key,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      if v_transition.id is null then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      -- The Action Form answers, which the API checked against the Transition's
      -- schema: here only that each is one of its fields and each field it always
      -- requires is answered, so the app role can't write others (a Return without its reason).
      if not app.action_form_fits(v_transition.action_form, p_answers) then
        return 'invalid_action_form';
      end if;
      -- Moving on by a Member who may save the answers now (the raiser while they
      -- are open, Draft and its internal Steps, so a Submit too; or the Participant
      -- holding a Step a Form Section names): only with the answers the API found
      -- complete (the row is locked). A cancel or a Return needs no complete Form.
      -- (app.answers_sha256 without checking again: where it may save, app.answers_open
      -- is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return') and app.can_save_answers(p_work_item_id)
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;

      -- The next holder (§3): the Participant, then, coming back by Return, the
      -- person who held that Step before if still in its pool; otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      if v_transition.kind = 'return' then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_next.participant_id))
        order by a.done_at desc, a.id desc limit 1;
      end if;

      -- Effects, in order.
      -- The Document Number, from the Numbering Pattern in effect (gap-free: in this transaction).
      if v_item.document_number is null and v_transition.from_draft then
        if v_item.revision_no > 0 then
          -- RP-316: a Revision takes its chain's base number with " Rev n", and no counter.
          v_number := (select r.document_number from work_item r where r.id = v_item.root_id) || ' Rev ' || v_item.revision_no;
        else
          v_number := app.issue_document_number(p_work_item_id, v_at);
        end if;
      end if;

      if v_next.outcome = 'terminal' then
        v_outcome := coalesce(v_transition.outcome, case when v_transition.kind = 'cancel' then 'cancelled' end);
        -- Publish-time validation requires one (workflow-engine.md §1, check 3); never guess it.
        if v_outcome is null then
          raise exception 'Transition % closes the item without an outcome', v_transition.key;
        end if;
      end if;
      -- The Internal Note stays inside the writer's Participant even when the
      -- Transition crosses to another (V5). It goes just before the Transition it
      -- is written with.
      if v_note is not null then
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          payload, audience, audience_participant_id, created_at
        ) values (
          v_item.project_id, p_work_item_id, 'internal_note', v_member_id, v_me.participant_id, v_transition.id,
          jsonb_build_object('internal_note', v_note), 'internal', v_me.participant_id, v_at
        );
      end if;
      -- It leaves the acting Participant: handed to another, or closed (nobody holds it).
      v_crosses := v_next.participant_id is distinct from v_me.participant_id;
      -- A Return out of a Step of a Participant other than the raiser discards what
      -- it wrote: the sections it fills go back to how they arrived, their field
      -- times too, before the trigger clears the "as arrived" copy (V19).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'return' and v_crosses and v_me.participant_id <> v_item.raised_by_participant_id
        and v_item.data_as_arrived is not null
      then
        v_discarded := array(
          select k from unnest(app.revision_dropped_keys(p_work_item_id)) k where k not in ('trade', 'location', 'scopes'));
        v_data := (v_data - v_discarded) || coalesce((
          select jsonb_object_agg(k, v_item.data_as_arrived -> k) from unnest(v_discarded) k where v_item.data_as_arrived ? k), '{}');
        v_times := (v_times - v_discarded) || coalesce((
          select jsonb_object_agg(k, a.times -> k)
          from unnest(v_discarded) k
          cross join (select coalesce(v_item.field_times_as_arrived, v_item.field_times) as times) a
          where a.times ? k), '{}');
      end if;
      -- Only what crosses is shared: a move inside one Participant stays its own,
      -- even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'close') then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id,
        -- A Code is issued only where one is set; any other move from that Step is a plain Transition.
        case when v_transition.from_outcome_mode = 'issue_code' and v_outcome is not null then 'issue_code'
          else 'transition' end,
        v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        -- The Action Form answers, then what the engine writes (no Action Form field takes those keys).
        jsonb_strip_nulls(p_answers || jsonb_build_object('document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_data)::text, 'UTF8')),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        participant_entered_at = case when v_crosses then v_at else participant_entered_at end,
        participant_entered_step_id = case when v_crosses then v_transition.to_step_id else participant_entered_step_id end,
        document_number = coalesce(document_number, v_number),
        outcome = v_outcome,
        closed_at = case when v_outcome is not null then v_at end,
        data = v_data,
        field_times = v_times,
        updated_at = v_at
      where id = p_work_item_id;
      if v_discarded is not null then
        perform app.sync_link_answers(p_work_item_id, v_item.project_id, v_item.form_version_id, v_data, v_at);
      end if;

      -- RP-316: the item a Revision revises links to it from its first Submit, never
      -- while it is the raiser's own (V1).
      if v_transition.kind = 'submit' and v_item.revision_of_id is not null then
        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_item.project_id, v_item.revision_of_id, p_work_item_id, 'related', v_member_id, v_at)
        on conflict on constraint work_item_link_once do nothing;
      end if;

      if v_next.outcome = 'ok' then
        insert into step_assignment (
          project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
        ) values (
          v_item.project_id, p_work_item_id, v_transition.to_step_id, v_next.participant_id, v_holder,
          case when v_holder is null then 'pooled' else 'claimed' end,
          case when v_holder is null then null else v_at end, v_at, v_at
        );
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (p_work_item_id, v_item.project_id, v_next.participant_id, v_at, 'handling')
        on conflict do nothing;
      end if;

      -- Oversight (V2): Owners and Owner Representatives whose Visibility covers the Submitted item.
      if v_transition.kind = 'submit' then
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select p_work_item_id, v_item.project_id, p.id, v_at, 'oversight'
        from participant p
        join project_role r on r.id = p.project_role_id
        where p.project_id = v_item.project_id and p.status = 'active'
          and r.base_role in ('owner', 'owner_representative')
          and app.participant_covers_item(p.id, p_work_item_id)
        on conflict do nothing;
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- Grants --------------------------------------------------------------------------

revoke all on function
  app.set_work_item_root(),
  app.latest_draft_step(uuid),
  app.can_create_revision(uuid),
  app.can_discard_revision(uuid),
  app.revision_versions_changed(uuid),
  app.form_field_type(uuid, text),
  app.create_revision(uuid, uuid, timestamptz),
  app.revision_document_copies(uuid),
  app.discard_revision(uuid, timestamptz)
  from public;
-- Only app.create_revision fills a Revision now.
revoke execute on function app.fill_revision(uuid, uuid, timestamptz) from rabaed_app;
grant execute on function
  app.can_create_revision(uuid),
  app.can_discard_revision(uuid),
  app.revision_versions_changed(uuid),
  app.create_revision(uuid, uuid, timestamptz),
  app.revision_document_copies(uuid),
  app.discard_revision(uuid, timestamptz)
  to rabaed_app;
