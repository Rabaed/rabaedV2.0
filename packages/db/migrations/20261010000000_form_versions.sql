-- Forms and Form Versions (form-engine.md; ADR 0002, ADR 0006; RP-262, spec RP-261).
--
-- * form_definition and form_version follow the library pattern of Workflows
--   (owner kind Rabaed or Project). A Version holds its schema (form-engine.md §1)
--   and, once published, never changes: rabaed_app can't write either table, and
--   a trigger refuses any UPDATE or DELETE of a published Version even to its owner.
-- * Rabaed ships the MAR Form Version 1 as a Rabaed Default, written here as data.
--   It replaces the skeleton's hard-coded description, which becomes its
--   `description` answer. Trade and Location stay where they are (RP-270 moves them).
-- * work_item_type.form_definition_id: each Type points at its Form.
-- * work_item.form_version_id: a new item is pinned to the latest published
--   Version of its Type's Form, as it is to its Workflow Version. The answers stay
--   in work_item.data.
-- * The API validates answers with the shared validator (packages/domain form.ts)
--   against the pinned Version; the database keeps who may write them and when:
--   - app.create_work_item takes the Version the API checked the answers against,
--     and refuses ('form_version_not_latest') if it isn't the latest any more.
--   - app.save_work_item_answers: the raiser's Participant, while the item is in
--     Draft. Later edits (internal Steps, field-level history) are RP-268.
--   - app.take_transition: leaving Draft needs the hash of the answers the API
--     found complete; if they aren't exactly the item's answers now (never
--     checked, or changed since) it refuses with 'form_not_checked'.
-- Existing items (dev holds demo data only, which is re-seeded) are pinned to the
-- MAR Form Version 1; their answers are not migrated.

-- Definitions ------------------------------------------------------------------

create table form_definition (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid references project (id),
  name jsonb not null check (app.is_bilingual(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);

create table form_version (
  id uuid primary key default app.uuid_v7(),
  form_definition_id uuid not null references form_definition (id),
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'published')),
  -- {"sections": [...]} (form-engine.md §1), checked by the domain's formSchema.
  schema jsonb not null check (jsonb_typeof(schema -> 'sections') = 'array'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_version_definition_no_key unique (form_definition_id, version_no),
  check ((status = 'published') = (published_at is not null))
);

-- A published Version is frozen: Work Items filled with it must always read and
-- validate the same (ADR 0006). A draft may still change, or be published.
create function app.refuse_published_form_version_change() returns trigger
  language plpgsql
  as $$
    begin
      if old.status = 'published' then
        raise exception 'a published form_version never changes' using errcode = '42501';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end
  $$;
create trigger form_version_published_frozen before update or delete on form_version
  for each row execute function app.refuse_published_form_version_change();

alter table form_definition enable row level security;
alter table form_version enable row level security;
revoke insert, update, delete, truncate on form_definition, form_version from rabaed_app;

-- Rabaed Defaults for any active Member; a Project's own on that Project.
create policy member_reads_form_definitions on form_definition for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );
-- Published Versions only, with their definition (the subquery is itself filtered).
create policy member_reads_form_versions on form_version for select to rabaed_app
  using (status = 'published' and form_definition_id in (select id from form_definition));

-- The Rabaed Default MAR Form, Version 1 -------------------------------------------

alter table work_item_type add column form_definition_id uuid references form_definition (id);

do $$
  declare
    v_definition uuid;
  begin
    insert into form_definition (owner_kind, name)
    values ('rabaed', '{"en": "Material Submittal (MAR)", "ar": "اعتماد المواد (MAR)"}')
    returning id into v_definition;
    insert into form_version (form_definition_id, version_no, status, published_at, schema)
    values (v_definition, 1, 'published', now(), $schema$
      {
        "sections": [
          {
            "key": "material",
            "title": { "en": "Material details", "ar": "تفاصيل المادة" },
            "fields": [
              { "key": "manufacturer", "type": "text", "required": true,
                "label": { "en": "Manufacturer", "ar": "المصنّع" } },
              { "key": "model", "type": "text", "required": false,
                "label": { "en": "Model", "ar": "الطراز" } },
              { "key": "specification_section", "type": "text", "required": false,
                "label": { "en": "Specification section", "ar": "بند المواصفات" },
                "help": { "en": "The section of the Project specification this material answers.",
                          "ar": "بند مواصفات المشروع الذي تستوفيه هذه المادة." } }
            ]
          },
          {
            "key": "details",
            "title": { "en": "Description", "ar": "الوصف" },
            "fields": [
              { "key": "description", "type": "textarea", "required": true,
                "label": { "en": "Description", "ar": "الوصف" } }
            ]
          }
        ]
      }
    $schema$::jsonb);
    update work_item_type set form_definition_id = v_definition where owner_kind = 'rabaed' and code = 'MAR';
  end
$$;

-- Every Rabaed Default Type has its Form. A Project's own Types (no function writes
-- them yet) get theirs with the library copy-down. Not validated against old rows:
-- test databases keep Types their suites wrote before this migration.
alter table work_item_type add constraint work_item_type_rabaed_has_form
  check (owner_kind <> 'rabaed' or form_definition_id is not null) not valid;

-- Pinning ----------------------------------------------------------------------------

alter table work_item add column form_version_id uuid references form_version (id);
-- Every existing item is a MAR, or (in test databases) of a test-only Type with no Form.
update work_item set form_version_id = (
  select v.id from form_version v
  join work_item_type t on t.form_definition_id = v.form_definition_id
  where t.owner_kind = 'rabaed' and t.code = 'MAR' and v.version_no = 1
);
alter table work_item alter column form_version_id set not null;
-- work_item is granted column by column (step_age_by_holder migration).
grant select (form_version_id) on work_item to rabaed_app;

-- The latest published Version of the Form of the Rabaed Default Type with p_type_code.
create function app.latest_form_version(p_type_code text) returns uuid
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select v.id from form_version v
    join work_item_type t on t.form_definition_id = v.form_definition_id
    where t.owner_kind = 'rabaed' and t.code = p_type_code and v.status = 'published'
    order by v.version_no desc limit 1
  $$;

-- Creating a Draft -------------------------------------------------------------------

drop function app.create_work_item(uuid, text, text, text, uuid, uuid, timestamptz);

-- As in the work items migration, but with the Form's answers instead of a
-- description: p_data, already checked by the API (draft mode) against
-- p_form_version_id, the Version the item is pinned to. Outcomes as before, plus
-- 'form_version_not_latest' when p_form_version_id isn't the latest published
-- Version of the Type's Form (a new one was published meanwhile: check again).
create function app.create_work_item(
  p_project_id uuid, p_type_code text, p_title text, p_form_version_id uuid, p_data jsonb,
  p_trade_id uuid, p_location_id uuid, p_now timestamptz
) returns table (outcome text, work_item_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_project_member_id uuid;
      v_participant_id uuid;
      v_base_role text;
      v_type record;
      v_version_id uuid;
      v_step record;
      v_trade_dimension uuid;
      v_location_dimension uuid;
      v_item_id uuid;
    begin
      select pm.id, pm.participant_id, r.base_role into v_project_member_id, v_participant_id, v_base_role
      from project_member pm
      join participant p on p.id = pm.participant_id
      join project_role r on r.id = p.project_role_id
      where pm.project_id = p_project_id and pm.member_id = app.current_member_id() and pm.status = 'active'
        and p.status = 'active' and p.company_id = app.current_company_id()
        and p_project_id in (select app.current_project_ids());
      if v_project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;

      select t.id, t.module_key, t.workflow_definition_id into v_type
      from work_item_type t where t.owner_kind = 'rabaed' and t.code = p_type_code;
      if v_type.id is null then
        return query select 'type_not_found'::text, null::uuid;
        return;
      end if;
      -- New items use the latest published Form Version, and stay on it.
      if p_form_version_id is distinct from app.latest_form_version(p_type_code) then
        return query select 'form_version_not_latest'::text, null::uuid;
        return;
      end if;
      -- And the latest published Workflow version.
      select v.id into v_version_id from workflow_version v
      where v.workflow_definition_id = v_type.workflow_definition_id and v.status = 'published'
      order by v.version_no desc limit 1;
      -- The start: the one Step in a Stage of category draft.
      select s.id, s.stage_key, s.actor_rule into v_step
      from workflow_step s
      join stage st on st.owner_kind = 'rabaed' and st.module_key = v_type.module_key and st.key = s.stage_key
      where s.workflow_version_id = v_version_id and st.category = 'draft';
      if v_step.actor_rule ->> 'base_role' is distinct from v_base_role then
        raise exception 'only a % can raise this Work Item Type', initcap(v_step.actor_rule ->> 'base_role')
          using errcode = '42501';
      end if;

      if p_trade_id is null then
        return query select 'trade_required'::text, null::uuid;
        return;
      end if;
      v_trade_dimension := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension := app.project_dimension_id(p_project_id, 'location');
      if not exists (select 1 from dimension_value where id = p_trade_id and dimension_id = v_trade_dimension)
        or (p_location_id is not null
          and not exists (select 1 from dimension_value where id = p_location_id and dimension_id = v_location_dimension))
      then
        return query select 'value_not_found'::text, null::uuid;
        return;
      end if;
      if p_trade_id not in (select app.values_covered_by_project_member(v_project_member_id, v_trade_dimension))
        or (p_location_id is not null
          and p_location_id not in (select app.values_covered_by_project_member(v_project_member_id, v_location_dimension)))
      then
        return query select 'outside_visibility'::text, null::uuid;
        return;
      end if;

      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at, created_at, updated_at
      ) values (
        p_project_id, v_type.id, v_participant_id, app.current_member_id(), btrim(p_title), coalesce(p_data, '{}'),
        v_version_id, p_form_version_id, v_step.id, v_step.stage_key, v_at, v_at, v_at
      ) returning id into v_item_id;

      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select v_item_id, p_project_id, d.dimension_id, d.value_id
      from (values (v_trade_dimension, p_trade_id), (v_location_dimension, p_location_id)) as d (dimension_id, value_id)
      where d.value_id is not null;

      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_item_id, p_project_id, v_participant_id, v_at, 'raised');

      insert into step_assignment (project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at)
      values (p_project_id, v_item_id, v_step.id, v_participant_id, app.current_member_id(), 'claimed', v_at, v_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        p_project_id, v_item_id, 'created', app.current_member_id(), v_participant_id, v_step.id,
        jsonb_build_object('title', btrim(p_title)), 'internal', v_participant_id, v_at
      );

      return query select 'created'::text, v_item_id;
    end
  $$;

-- Saving the answers -----------------------------------------------------------------

-- Whether the acting Member may save a visible item's answers now: their
-- Participant raised it, it is open in Draft, and its Project is active (RP-268
-- adds the raiser's internal Steps). The one rule Save draft and its button follow.
create function app.can_save_answers(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from work_item w
      join project pr on pr.id = w.project_id and pr.status = 'active'
      cross join lateral app.acting_project_member(w.id) me
      where w.id = p_work_item_id and me.participant_id = w.raised_by_participant_id
        and w.closed_at is null and app.is_draft_step(w.current_step_id)
    )
  $$;

-- The acting Member saves the answers of a visible item, already checked by the
-- API (draft mode) against its pinned Form Version. Only the raiser's Participant,
-- and only while the item is in Draft (RP-268 adds its internal Steps).
-- Outcome: 'saved', 'not_found', 'project_closed' or 'not_editable'.
create function app.save_work_item_answers(p_work_item_id uuid, p_data jsonb, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- Locked, so a Transition out of Draft checks exactly the answers it moves with.
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
      if not app.can_save_answers(p_work_item_id) then
        return 'not_editable';
      end if;
      update work_item set data = coalesce(p_data, '{}'), updated_at = v_at where id = p_work_item_id;
      return 'saved';
    end
  $$;

-- Taking a Transition ----------------------------------------------------------------

-- The SHA-256 of a visible item's answers, as take_transition compares them; null
-- for an item the caller can't see (it reads through their RLS).
create function app.answers_sha256(p_work_item_id uuid) returns bytea
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(data::text, 'UTF8')) from work_item where id = p_work_item_id
  $$;

drop function app.take_transition(uuid, text, text, text, uuid, timestamptz);

-- As in the step_age_by_holder migration, with p_checked_data_sha256: the SHA-256
-- of the answers (app.answers_sha256) the API found complete against the pinned
-- Form Version. A Transition out of a Draft Step, other than a cancel, is refused
-- with 'form_not_checked' unless it is the hash of the item's answers now. The
-- database doesn't validate answers itself: the shared validator does, in the API.
create function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_reason text, p_internal_note text, p_checked_data_sha256 bytea,
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
      v_raiser record;
      v_reason text := nullif(btrim(p_reason), '');
      v_note text := nullif(btrim(p_internal_note), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
      v_outcome text;
      v_crosses boolean;
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
      if v_transition.kind = 'return' and v_reason is null then
        return 'reason_required';
      end if;
      -- Leaving Draft: only with the answers the API found complete (the row is
      -- locked). Cancelling a Draft needs no complete Form.
      if v_transition.from_draft and v_transition.kind <> 'cancel'
        and p_checked_data_sha256 is distinct from app.answers_sha256(p_work_item_id)
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
      if v_item.document_number is null and v_transition.from_draft then
        select p.ordinal into v_raiser from participant p where p.id = v_item.raised_by_participant_id;
        v_prefix := concat_ws('-', v_item.project_code, v_item.type_code,
          lpad(v_raiser.ordinal::text, greatest(2, length(v_raiser.ordinal::text)), '0'));
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_prefix, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := v_prefix || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
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
        jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'document_number', v_number, 'outcome', v_outcome)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
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
        updated_at = v_at
      where id = p_work_item_id;

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

revoke all on function
  app.refuse_published_form_version_change(),
  app.latest_form_version(text),
  app.answers_sha256(uuid),
  app.can_save_answers(uuid),
  app.create_work_item(uuid, text, text, uuid, jsonb, uuid, uuid, timestamptz),
  app.save_work_item_answers(uuid, jsonb, timestamptz),
  app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz)
  from public;
grant execute on function
  app.latest_form_version(text),
  app.answers_sha256(uuid),
  app.can_save_answers(uuid),
  app.create_work_item(uuid, text, text, uuid, jsonb, uuid, uuid, timestamptz),
  app.save_work_item_answers(uuid, jsonb, timestamptz),
  app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz)
  to rabaed_app;
