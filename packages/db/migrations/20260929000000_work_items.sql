-- Work Items: the MAR Work Item Type, its Workflow, and Drafts (data-model.md §4,
-- §5, §9; workflow-engine.md; RP-192).
--
-- * Stages, the Workflow and the Work Item Type are data. This migration seeds
--   the Rabaed Default "Material Submittal (MAR)": one published Workflow version
--   with its Steps and Transitions (workflow-engine.md §1, trimmed to Draft →
--   Internal Review → Pending Approval → Approved / Revise & Resubmit).
-- * A Contractor Member creates a Work Item in Draft (app.create_work_item). It is
--   pinned to that Workflow version, holds a Trade (required) and a Location,
--   gives its Participant access ('raised'), is held by its creator, and gets its
--   first history event.
-- * Seeing a Work Item (data-model.md §10) needs an active Project Member, a
--   work_item_access row for their Participant, and their Visibility covering
--   every dimension value of the item. While it is at a Step held by the
--   raiser's own role (its internal Steps), only the raiser qualifies (V1).
--   Its other tables are seen exactly when the item is; internal history events
--   only by their Participant (layer 5).
-- * work_item_event is append-only: rabaed_app can't write it at all, and a
--   trigger refuses UPDATE and DELETE even to its owner. Each event carries a
--   gap-free seq and a prev_hash → hash chain.
--
-- As before, rabaed_app writes only through the SECURITY DEFINER functions below.
--
-- Deferred: a Project's own copies of Types, Workflows and Stages (the library
-- pattern's copy-down; every Project uses the Rabaed Defaults for now), Forms
-- (form_version_id: the MAR has title and description only), Revisions,
-- Subtasks, Packages, signatures, Document Numbers (at first exit from Draft,
-- RP-193), take_transition, idempotency keys, and the outbox.

-- Definitions ------------------------------------------------------------------

-- The shared Stage set of each Module: the Kanban columns.
create table stage (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid references project (id),
  module_key text not null check (module_key in ('submittals', 'inspections', 'snag_list', 'site_reports', 'drawings')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name jsonb not null check (app.is_bilingual(name)),
  category text not null check (category in ('draft', 'in_progress', 'closed_positive', 'closed_negative', 'cancelled')),
  sort integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);
create unique index stage_rabaed_key on stage (module_key, key) where owner_kind = 'rabaed';

create table workflow_definition (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid references project (id),
  name jsonb not null check (app.is_bilingual(name)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);

-- Published versions never change; Work Items stay on the version they started with.
create table workflow_version (
  id uuid primary key default app.uuid_v7(),
  workflow_definition_id uuid not null references workflow_definition (id),
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'published')),
  layout jsonb not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_version_definition_no_key unique (workflow_definition_id, version_no),
  check ((status = 'published') = (published_at is not null))
);

create table workflow_step (
  id uuid primary key default app.uuid_v7(),
  workflow_version_id uuid not null references workflow_version (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name jsonb not null check (app.is_bilingual(name)),
  stage_key text not null,
  -- Who may hold it: {"base_role": ..., "permission": ...}; empty on terminal Steps.
  actor_rule jsonb not null,
  is_signing boolean not null default false,
  outcome_mode text not null default 'none'
    check (outcome_mode in ('none', 'recommend_code', 'issue_code', 'inspection_result')),
  created_at timestamptz not null default now(),
  constraint workflow_step_version_key unique (workflow_version_id, key),
  constraint workflow_step_id_version_key unique (id, workflow_version_id)
);

create table workflow_transition (
  id uuid primary key default app.uuid_v7(),
  workflow_version_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  from_step_id uuid not null,
  to_step_id uuid not null,
  label jsonb not null check (app.is_bilingual(label)),
  kind text not null check (kind in ('send', 'submit', 'return', 'close', 'cancel')),
  outcome text check (outcome in ('A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'closed')),
  permission text not null
    check (permission in ('view', 'create', 'submit', 'review', 'approve', 'assign', 'close', 'attach')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint workflow_transition_from_fk
    foreign key (from_step_id, workflow_version_id) references workflow_step (id, workflow_version_id),
  constraint workflow_transition_to_fk
    foreign key (to_step_id, workflow_version_id) references workflow_step (id, workflow_version_id),
  constraint workflow_transition_version_key unique (workflow_version_id, key)
);

create table work_item_type (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid references project (id),
  module_key text not null check (module_key in ('submittals', 'inspections', 'snag_list', 'site_reports', 'drawings')),
  -- Used in filters and Document Numbers.
  code text not null check (code ~ '^[A-Z]{2,6}$'),
  name jsonb not null check (app.is_bilingual(name)),
  workflow_definition_id uuid not null references workflow_definition (id),
  outcome_kind text not null check (outcome_kind in ('review_code', 'inspection_result', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);
create unique index work_item_type_rabaed_code_key on work_item_type (code) where owner_kind = 'rabaed';

-- The Rabaed Default MAR -------------------------------------------------------------

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'submittals', 'draft', '{"en": "Drafts", "ar": "المسودات"}', 'draft', 1),
  ('rabaed', 'submittals', 'internal_review', '{"en": "Internal Review", "ar": "المراجعة الداخلية"}', 'in_progress', 2),
  ('rabaed', 'submittals', 'pending_approval', '{"en": "Pending Approval", "ar": "بانتظار الاعتماد"}', 'in_progress', 3),
  ('rabaed', 'submittals', 'approved', '{"en": "Approved", "ar": "معتمد"}', 'closed_positive', 4),
  ('rabaed', 'submittals', 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'closed_negative', 5);

do $$
  declare
    v_definition uuid;
    v_version uuid;
  begin
    insert into workflow_definition (owner_kind, name)
    values ('rabaed', '{"en": "Material Submittal (MAR)", "ar": "اعتماد المواد (MAR)"}')
    returning id into v_definition;
    insert into workflow_version (workflow_definition_id, version_no, status, published_at)
    values (v_definition, 1, 'published', now())
    returning id into v_version;

    insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
      (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft',
        '{"base_role": "contractor", "permission": "create"}', 'none'),
      (v_version, 'internal_review', '{"en": "Contractor review", "ar": "مراجعة المقاول"}', 'internal_review',
        '{"base_role": "contractor", "permission": "review"}', 'none'),
      (v_version, 'consultant_review', '{"en": "Consultant review", "ar": "مراجعة الاستشاري"}', 'pending_approval',
        '{"base_role": "consultant", "permission": "approve"}', 'issue_code'),
      (v_version, 'approved', '{"en": "Approved", "ar": "معتمد"}', 'approved', '{}', 'none'),
      (v_version, 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}', 'revise_resubmit', '{}', 'none');

    insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort)
    select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort
    from (values
      ('send_for_review', 'draft', 'internal_review', '{"en": "Send for Review", "ar": "إرسال للمراجعة"}', 'send', null, 'create', 1),
      ('return', 'internal_review', 'draft', '{"en": "Return", "ar": "إعادة"}', 'return', null, 'review', 2),
      ('submit', 'internal_review', 'consultant_review', '{"en": "Submit", "ar": "تقديم"}', 'submit', null, 'submit', 3),
      ('approve_a', 'consultant_review', 'approved', '{"en": "Approve · A", "ar": "اعتماد · A"}', 'close', 'A', 'approve', 4),
      ('revise_c', 'consultant_review', 'revise_resubmit',
        '{"en": "Revise & Resubmit · C", "ar": "مراجعة وإعادة تقديم · C"}', 'close', 'C', 'approve', 5)
    ) as t (key, from_key, to_key, label, kind, outcome, permission, sort)
    join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
    join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind)
    values ('rabaed', 'submittals', 'MAR', '{"en": "Material Submittal", "ar": "اعتماد المواد"}', v_definition, 'review_code');
  end
$$;

-- Work Items -------------------------------------------------------------------------

create table work_item (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null references project (id),
  work_item_type_id uuid not null references work_item_type (id),
  raised_by_participant_id uuid not null,
  created_by_member_id uuid not null references member (id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- The Form answers; the MAR's free-text description until the Form engine.
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  workflow_version_id uuid not null references workflow_version (id),
  -- Null while Draft; set at first leaving Draft.
  document_number text,
  current_step_id uuid not null,
  current_stage_key text not null,
  -- Feeds Step Age.
  step_entered_at timestamptz not null,
  outcome text check (outcome in ('A', 'B', 'C', 'D', 'passed', 'passed_with_comments', 'failed', 'cancelled', 'closed')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_item_raiser_fk
    foreign key (raised_by_participant_id, project_id) references participant (id, project_id),
  constraint work_item_step_fk
    foreign key (current_step_id, workflow_version_id) references workflow_step (id, workflow_version_id),
  constraint work_item_id_project_key unique (id, project_id),
  check ((outcome is null) = (closed_at is null))
);
create index work_item_project_id_idx on work_item (project_id);

-- Exactly one value per dimension; Trade is required (checked on create).
create table work_item_dimension_value (
  work_item_id uuid not null,
  project_id uuid not null,
  dimension_id uuid not null,
  dimension_value_id uuid not null,
  primary key (work_item_id, dimension_id),
  constraint work_item_dimension_value_item_fk
    foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint work_item_dimension_value_dimension_fk
    foreign key (dimension_id, project_id) references visibility_dimension (id, project_id),
  constraint work_item_dimension_value_value_fk
    foreign key (dimension_value_id, dimension_id) references dimension_value (id, dimension_id)
);

-- Who holds the current Step: a Member, or the Participant's Step Pool (assignee null).
create table step_assignment (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  work_item_id uuid not null,
  step_id uuid not null references workflow_step (id),
  participant_id uuid not null,
  assignee_member_id uuid references member (id),
  status text not null check (status in ('pooled', 'claimed', 'done', 'vacant', 'reassigned')),
  claimed_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint step_assignment_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint step_assignment_participant_fk
    foreign key (participant_id, project_id) references participant (id, project_id),
  check (status <> 'claimed' or assignee_member_id is not null)
);
-- One open assignment per item: the current holder.
create unique index step_assignment_open_key on step_assignment (work_item_id)
  where status in ('pooled', 'claimed', 'vacant');

-- Which Participants have access (layer 3), maintained by the engine.
create table work_item_access (
  work_item_id uuid not null,
  project_id uuid not null,
  participant_id uuid not null,
  since timestamptz not null,
  reason text not null check (reason in ('raised', 'handling', 'oversight')),
  primary key (work_item_id, participant_id),
  constraint work_item_access_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint work_item_access_participant_fk
    foreign key (participant_id, project_id) references participant (id, project_id)
);
create index work_item_access_participant_id_idx on work_item_access (participant_id);

-- The legal trail: append-only, gap-free seq per item, hash-chained.
create table work_item_event (
  id uuid primary key default app.uuid_v7(),
  project_id uuid not null,
  work_item_id uuid not null,
  -- Set by the chain trigger.
  seq integer not null default 0,
  type text not null check (type in (
    'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'claimed', 'vacated',
    'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled'
  )),
  actor_member_id uuid references member (id),
  actor_engineer_id uuid references rabaed_engineer (id),
  actor_participant_id uuid,
  transition_id uuid references workflow_transition (id),
  from_step_id uuid references workflow_step (id),
  to_step_id uuid references workflow_step (id),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  audience text not null check (audience in ('shared', 'internal')),
  audience_participant_id uuid,
  -- Hash of the item data and its Documents at that moment (with Documents, later).
  content_sha256 bytea,
  prev_hash bytea,
  hash bytea not null default '\x',
  created_at timestamptz not null default now(),
  constraint work_item_event_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id),
  constraint work_item_event_actor_participant_fk
    foreign key (actor_participant_id, project_id) references participant (id, project_id),
  constraint work_item_event_audience_participant_fk
    foreign key (audience_participant_id, project_id) references participant (id, project_id),
  constraint work_item_event_item_seq_key unique (work_item_id, seq),
  check ((actor_member_id is null) <> (actor_engineer_id is null)),
  check ((audience = 'internal') = (audience_participant_id is not null)),
  check (seq > 0),
  check ((seq = 1) = (prev_hash is null))
);

-- The chain ------------------------------------------------------------------------

-- An event's hash: SHA-256 over every field but the hash itself, prev_hash
-- included, so changing any event breaks its own hash and every later link.
create function app.work_item_event_hash(e work_item_event) returns bytea
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select sha256(convert_to(concat_ws(E'\n',
      'rabaed.work_item_event.v1',
      e.id::text, e.project_id::text, e.work_item_id::text, e.seq::text, e.type,
      coalesce(e.actor_member_id::text, ''), coalesce(e.actor_engineer_id::text, ''),
      coalesce(e.actor_participant_id::text, ''), coalesce(e.transition_id::text, ''),
      coalesce(e.from_step_id::text, ''), coalesce(e.to_step_id::text, ''),
      e.payload::text, e.audience, coalesce(e.audience_participant_id::text, ''),
      coalesce(encode(e.content_sha256, 'hex'), ''), coalesce(encode(e.prev_hash, 'hex'), ''),
      (extract(epoch from e.created_at) * 1000000)::bigint::text
    ), 'UTF8'))
  $$;

-- Numbers and links each new event. The item row is locked first, so concurrent
-- appends to one item queue up and seq stays gap-free.
create function app.chain_work_item_event() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_last record;
    begin
      perform 1 from work_item where id = new.work_item_id for update;
      select seq, hash, created_at into v_last from work_item_event
      where work_item_id = new.work_item_id order by seq desc limit 1;
      new.seq := coalesce(v_last.seq, 0) + 1;
      new.prev_hash := v_last.hash;
      -- Never earlier than the event before it.
      new.created_at := greatest(new.created_at, v_last.created_at);
      new.hash := app.work_item_event_hash(new);
      return new;
    end
  $$;
create trigger work_item_event_chain before insert on work_item_event
  for each row execute function app.chain_work_item_event();

create function app.refuse_work_item_event_change() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'work_item_event is append-only' using errcode = '42501';
    end
  $$;
create trigger work_item_event_append_only before update or delete on work_item_event
  for each row execute function app.refuse_work_item_event_change();
create trigger work_item_event_no_truncate before truncate on work_item_event
  for each statement execute function app.refuse_work_item_event_change();

-- Whether an item's history is untouched: seq runs 1, 2, 3…, every hash matches
-- its event, and every prev_hash is the hash before it.
create function app.work_item_chain_intact(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select coalesce(bool_and(ok), true) from (
      select e.seq = row_number() over w
        and e.hash = app.work_item_event_hash(e)
        and e.prev_hash is not distinct from lag(e.hash) over w as ok
      from work_item_event e
      where e.work_item_id = p_work_item_id
      window w as (order by e.seq)
    ) x
  $$;

-- Access for rabaed_app -------------------------------------------------------------

alter table stage enable row level security;
alter table workflow_definition enable row level security;
alter table workflow_version enable row level security;
alter table workflow_step enable row level security;
alter table workflow_transition enable row level security;
alter table work_item_type enable row level security;
alter table work_item enable row level security;
alter table work_item_dimension_value enable row level security;
alter table step_assignment enable row level security;
alter table work_item_access enable row level security;
alter table work_item_event enable row level security;

revoke insert, update, delete on
  stage, workflow_definition, workflow_version, workflow_step, workflow_transition, work_item_type,
  work_item, work_item_dimension_value, step_assignment, work_item_access, work_item_event
  from rabaed_app;
-- Rabaed Admin never rewrites history either.
revoke update, delete, truncate on work_item_event from rabaed_admin;

-- Definitions: Rabaed Defaults for any active Member; a Project's own on that Project.
create policy member_reads_stages on stage for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );
create policy member_reads_workflow_definitions on workflow_definition for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );
create policy member_reads_work_item_types on work_item_type for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );
-- A version, its Steps and Transitions: with their definition (the subqueries are themselves filtered).
create policy member_reads_workflow_versions on workflow_version for select to rabaed_app
  using (workflow_definition_id in (select id from workflow_definition));
create policy member_reads_workflow_steps on workflow_step for select to rabaed_app
  using (workflow_version_id in (select id from workflow_version));
create policy member_reads_workflow_transitions on workflow_transition for select to rabaed_app
  using (workflow_version_id in (select id from workflow_version));

-- Whether the acting Member sees a Work Item (data-model.md §10; visibility.md layers 2–4):
-- * layer 2: they are an active Project Member of its Project;
-- * layer 3: their Participant has a work_item_access row, and, while the item
--   is at one of its raiser's internal Steps (held by the raiser's own role),
--   their Participant is the raiser (V1);
-- * layer 4: their own Visibility covers every dimension value of the item (V4, V12).
create function app.sees_work_item(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
  $$;

create policy member_reads_visible_work_items on work_item for select to rabaed_app
  using (app.sees_work_item(id));
-- An item's other rows: exactly when the item is visible (the subquery is itself filtered).
create policy member_reads_visible_work_item_values on work_item_dimension_value for select to rabaed_app
  using (work_item_id in (select id from work_item));
create policy member_reads_visible_step_assignments on step_assignment for select to rabaed_app
  using (work_item_id in (select id from work_item));
create policy member_reads_visible_work_item_access on work_item_access for select to rabaed_app
  using (work_item_id in (select id from work_item));
-- History: shared events of visible items, and internal ones only for their own Participant (layer 5, V5).
create policy member_reads_visible_work_item_events on work_item_event for select to rabaed_app
  using (
    work_item_id in (select id from work_item)
    and (audience = 'shared' or audience_participant_id in (select app.current_participant_ids()))
  );

-- Creating a Draft -------------------------------------------------------------------

-- A Member creates a Work Item of the Type with p_type_code (a Rabaed Default)
-- in Draft on one of their Projects. Outcome: 'created' (with the item),
-- 'not_found' (not one of their Projects), 'project_closed', 'type_not_found',
-- 'trade_required', 'value_not_found' (not a Trade, or not a Location, of this
-- Project) or 'outside_visibility' (a value their own Visibility doesn't cover:
-- they would raise something they can't see). A Member whose Participant is not
-- in the role the Draft Step names is refused (42501).
create function app.create_work_item(
  p_project_id uuid, p_type_code text, p_title text, p_description text,
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
      -- New items use the latest published version, and stay on it.
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
        workflow_version_id, current_step_id, current_stage_key, step_entered_at, created_at, updated_at
      ) values (
        p_project_id, v_type.id, v_participant_id, app.current_member_id(), btrim(p_title),
        case when nullif(btrim(p_description), '') is null then '{}'::jsonb
          else jsonb_build_object('description', btrim(p_description)) end,
        v_version_id, v_step.id, v_step.stage_key, v_at, v_at, v_at
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

-- Internal helpers stay out of rabaed_app's reach; it calls only the entry points.
revoke all on function
  app.work_item_event_hash(work_item_event),
  app.chain_work_item_event(),
  app.refuse_work_item_event_change(),
  app.work_item_chain_intact(uuid),
  app.sees_work_item(uuid),
  app.create_work_item(uuid, text, text, text, uuid, uuid, timestamptz)
  from public;
grant execute on function
  app.sees_work_item(uuid),
  app.create_work_item(uuid, text, text, text, uuid, uuid, timestamptz)
  to rabaed_app;
grant execute on function app.work_item_chain_intact(uuid) to rabaed_admin;
