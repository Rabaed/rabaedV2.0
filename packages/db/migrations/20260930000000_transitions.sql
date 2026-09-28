-- Transitions inside the raising Participant: Send for Review, Return, Claim and
-- Release (workflow-engine.md §3, §5.1, §5.2, §8; RP-193).
--
-- * Positions (data-model.md §2), minimal: the Rabaed Default Positions of each
--   base role with their permissions, and the Participant's Authorized Person
--   gives their Project Members Positions. A Step Pool is the Participant's
--   active Project Members holding the Step's permission whose Visibility covers
--   the item (§3.2); a Transition needs its own permission (§5.1 check 4).
-- * app.take_transition: one transaction, the item row locked, an idempotency
--   key per Member, and every §5.1 check in order before anything is written.
--   The first exit from Draft assigns the Document Number (§8) from a simple
--   per-Participant counter: <project code>-<type code>-<Participant ordinal>-<seq>.
--   Each Participant counts on its own, so gaps never reveal another Company's
--   volume (visibility.md, Document Numbers).
-- * app.claim_step / app.release_step (§5.2): one of two simultaneous Claims wins.
-- * app.work_item_actions: exactly what the acting Member may press now.
-- * app.work_item_history: the item's events the Member may see (layer 5).
--
-- Skeleton limits: only Transitions to a Step held by the raiser's own role
-- (send, return); Submit to another Participant and closing come with RP-194,
-- notifications with RP-195. No Action Forms beyond a Return's reason, no
-- conditions, no signing, no default holders (§3.3 rule 3), no Documents to
-- freeze at first exit from Draft, no Project or Company Positions, no per-Type
-- permissions.

-- Positions --------------------------------------------------------------------------

create table position (
  id uuid primary key default app.uuid_v7(),
  owner_kind text not null check (owner_kind = 'rabaed'),
  base_role text not null check (base_role in ('contractor', 'consultant', 'owner', 'owner_representative')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name jsonb not null check (app.is_bilingual(name)),
  sort integer not null,
  created_at timestamptz not null default now(),
  constraint position_base_role_key unique (base_role, key)
);

-- A permission on a whole Module (per Work Item Type later).
create table position_permission (
  position_id uuid not null references position (id),
  module_key text not null check (module_key in ('submittals', 'inspections', 'snag_list', 'site_reports', 'drawings')),
  permission text not null
    check (permission in ('view', 'create', 'submit', 'review', 'approve', 'assign', 'close', 'attach')),
  primary key (position_id, module_key, permission)
);

alter table project_member add constraint project_member_id_project_key unique (id, project_id);

create table project_member_position (
  project_id uuid not null,
  project_member_id uuid not null,
  position_id uuid not null references position (id),
  created_at timestamptz not null default now(),
  primary key (project_member_id, position_id),
  constraint project_member_position_member_fk
    foreign key (project_member_id, project_id) references project_member (id, project_id)
);

insert into position (owner_kind, base_role, key, name, sort) values
  ('rabaed', 'contractor', 'engineer', '{"en": "Engineer", "ar": "مهندس"}', 1),
  ('rabaed', 'contractor', 'project_manager', '{"en": "Project Manager", "ar": "مدير المشروع"}', 2),
  ('rabaed', 'consultant', 'engineer', '{"en": "Engineer", "ar": "مهندس"}', 1),
  ('rabaed', 'consultant', 'manager', '{"en": "Manager", "ar": "مدير"}', 2),
  ('rabaed', 'owner', 'representative', '{"en": "Representative", "ar": "ممثل"}', 1),
  ('rabaed', 'owner_representative', 'engineer', '{"en": "Engineer", "ar": "مهندس"}', 1);

insert into position_permission (position_id, module_key, permission)
select p.id, 'submittals', x.permission
from (values
  ('contractor', 'engineer', 'view'), ('contractor', 'engineer', 'create'), ('contractor', 'engineer', 'attach'),
  ('contractor', 'project_manager', 'view'), ('contractor', 'project_manager', 'create'),
  ('contractor', 'project_manager', 'attach'), ('contractor', 'project_manager', 'review'),
  ('contractor', 'project_manager', 'submit'),
  ('consultant', 'engineer', 'view'), ('consultant', 'engineer', 'review'),
  ('consultant', 'manager', 'view'), ('consultant', 'manager', 'review'), ('consultant', 'manager', 'approve'),
  ('owner', 'representative', 'view'),
  ('owner_representative', 'engineer', 'view')
) as x (base_role, key, permission)
join position p on p.base_role = x.base_role and p.key = x.key;

-- Participant ordinals and Document Numbers -------------------------------------------

-- The Participant's place on its Project (1, 2, 3…): the Company segment of
-- Document Numbers until Projects configure numbering patterns.
alter table participant add column ordinal integer;
update participant p set ordinal = x.n
from (select id, row_number() over (partition by project_id order by created_at, id) as n from participant) x
where x.id = p.id;
alter table participant alter column ordinal set not null;
alter table participant add constraint participant_project_ordinal_key unique (project_id, ordinal);

create function app.number_participant() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      -- Concurrent additions to one Project queue up on its row.
      perform 1 from project where id = new.project_id for update;
      select coalesce(max(ordinal), 0) + 1 into new.ordinal from participant where project_id = new.project_id;
      return new;
    end
  $$;
create trigger participant_ordinal before insert on participant
  for each row execute function app.number_participant();

create table numbering_counter (
  project_id uuid not null references project (id),
  -- The resolved prefix the sequence counts under.
  counter_key text not null,
  last_value integer not null check (last_value > 0),
  primary key (project_id, counter_key)
);

create unique index work_item_document_number_key on work_item (project_id, document_number)
  where document_number is not null;

-- Idempotency ------------------------------------------------------------------------

-- A command applied under a Member's key; the same key again applies nothing.
create table command_idempotency (
  member_id uuid not null references member (id),
  key uuid not null,
  project_id uuid not null,
  work_item_id uuid not null,
  command text not null,
  created_at timestamptz not null default now(),
  primary key (member_id, key),
  constraint command_idempotency_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id)
);

-- Releasing a claimed Step back to its pool.
alter table work_item_event drop constraint work_item_event_type_check;
alter table work_item_event add constraint work_item_event_type_check check (type in (
  'created', 'transition', 'recommend_code', 'issue_code', 'assigned', 'claimed', 'released', 'vacated',
  'admin_reassigned', 'admin_reset', 'internal_note', 'cancelled'
));

-- Access for rabaed_app ----------------------------------------------------------

alter table position enable row level security;
alter table position_permission enable row level security;
alter table project_member_position enable row level security;
alter table numbering_counter enable row level security;
alter table command_idempotency enable row level security;

revoke insert, update, delete on
  position, position_permission, project_member_position, numbering_counter, command_idempotency
  from rabaed_app;
-- Counters and keys have no read policy: only the commands below touch them.

create policy member_reads_positions on position for select to rabaed_app
  using (app.current_company_id() is not null);
create policy member_reads_position_permissions on position_permission for select to rabaed_app
  using (position_id in (select id from position));
-- With the Project Member: only your own Participant's (V14; the subquery is itself filtered).
create policy member_reads_own_participant_member_positions on project_member_position for select to rabaed_app
  using (project_member_id in (select id from project_member));

-- The Participant's Authorized Person sets a Project Member's Positions (keys of
-- Rabaed Default Positions of the Participant's base role; empty removes all).
-- Outcome: 'set', 'not_found' (not one of their Company's Participants),
-- 'project_closed', 'member_not_found' (not an active Project Member through it)
-- or 'position_not_found'. Anyone but an Authorized Person is refused (42501).
create function app.set_project_member_positions(
  p_participant_id uuid, p_member_id uuid, p_position_keys text[]
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_company_id uuid := app.require_authorized_company_id();
      v_participant record;
      v_project_member_id uuid;
      v_position_ids uuid[];
    begin
      select p.project_id, r.base_role into v_participant
      from participant p join project_role r on r.id = p.project_role_id
      where p.id = p_participant_id and p.company_id = v_company_id and p.status = 'active';
      if v_participant.project_id is null then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = v_participant.project_id and status = 'closed') then
        return 'project_closed';
      end if;
      select id into v_project_member_id from project_member
      where participant_id = p_participant_id and member_id = p_member_id and status = 'active';
      if v_project_member_id is null then
        return 'member_not_found';
      end if;
      select coalesce(array_agg(id), '{}') into v_position_ids from position
      where base_role = v_participant.base_role and key = any (p_position_keys);
      if cardinality(v_position_ids) <> (select count(distinct k) from unnest(p_position_keys) k) then
        return 'position_not_found';
      end if;

      delete from project_member_position
      where project_member_id = v_project_member_id and position_id <> all (v_position_ids);
      insert into project_member_position (project_id, project_member_id, position_id)
      select v_participant.project_id, v_project_member_id, unnest(v_position_ids)
      on conflict do nothing;
      return 'set';
    end
  $$;

-- The engine -------------------------------------------------------------------------

-- Whether a Project Member holds p_permission in p_module_key through any Position.
create function app.project_member_has_permission(p_project_member_id uuid, p_module_key text, p_permission text)
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from project_member_position mp
      join position_permission pp on pp.position_id = mp.position_id
      where mp.project_member_id = p_project_member_id
        and pp.module_key = p_module_key and pp.permission = p_permission
    )
  $$;

-- The Step Pool (§3.2): the Participant's active Project Members, of an active
-- Company, holding the Step's permission, whose Visibility covers every
-- dimension value of the item.
create function app.step_pool(p_work_item_id uuid, p_step_id uuid, p_participant_id uuid)
  returns table (project_member_id uuid, member_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
      )
  $$;

-- The acting Member's own Project Member row on the item's Project, when they see the item.
create function app.acting_project_member(p_work_item_id uuid)
  returns table (project_member_id uuid, participant_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select pm.id, pm.participant_id
    from work_item w
    join project_member pm on pm.project_id = w.project_id
    join participant p on p.id = pm.participant_id
    where w.id = p_work_item_id and app.sees_work_item(w.id)
      and pm.member_id = app.current_member_id() and pm.status = 'active'
      and p.status = 'active' and p.company_id = app.current_company_id()
  $$;

-- The Transitions the acting Member may take now (§5.1 checks 1–4): the item is
-- open on an active Project, they see it and hold its claimed assignment, the
-- Transition leaves the current Step on the pinned version, they hold its
-- permission, and (skeleton) it leads to a Step of the raiser's own role.
create function app.takeable_transitions(p_work_item_id uuid)
  returns table (transition_id uuid, key text, label jsonb, kind text, sort integer)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select tr.id, tr.key, tr.label, tr.kind, tr.sort
    from work_item w
    join project pr on pr.id = w.project_id and pr.status = 'active'
    join work_item_type t on t.id = w.work_item_type_id
    cross join lateral app.acting_project_member(w.id) me
    join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
      and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
    join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
    join workflow_step target on target.id = tr.to_step_id
    join participant raiser on raiser.id = w.raised_by_participant_id
    join project_role raiser_role on raiser_role.id = raiser.project_role_id
    where w.id = p_work_item_id and w.closed_at is null
      and app.project_member_has_permission(me.project_member_id, t.module_key, tr.permission)
      and target.actor_rule ->> 'base_role' = raiser_role.base_role
      and exists (select 1 from app.step_pool(w.id, tr.to_step_id, raiser.id))
  $$;

-- Takes a Transition (§5.1) by its key. Outcome: 'applied' (also for the same
-- key again: nothing more happens), 'not_found' (they can't see the item),
-- 'item_closed', 'project_closed', 'not_holder', 'transition_not_available',
-- 'forbidden' (no permission), 'reason_required', 'no_step_pool' (nobody could
-- hold the next Step) or 'idempotency_key_reused'. Any refusal writes nothing.
-- A key is remembered only once applied: a replay answers 'applied' whatever its
-- reason, and a refused attempt may be retried under the same key.
create function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_reason text, p_idempotency_key uuid, p_now timestamptz
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
      v_raiser record;
      v_reason text := nullif(btrim(p_reason), '');
      v_holder uuid;
      v_number text;
      v_prefix text;
      v_seq integer;
      v_audience text;
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

      select tr.*, target.stage_key as to_stage_key, target.actor_rule as to_actor_rule,
        source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
      into v_transition
      from workflow_transition tr
      join workflow_step target on target.id = tr.to_step_id
      join workflow_step source on source.id = tr.from_step_id
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      select p.id, p.ordinal, r.base_role into v_raiser
      from participant p join project_role r on r.id = p.project_role_id
      where p.id = v_item.raised_by_participant_id;
      if v_transition.id is null or v_transition.to_actor_rule ->> 'base_role' is distinct from v_raiser.base_role then
        return 'transition_not_available';
      end if;
      if not app.project_member_has_permission(v_me.project_member_id, v_item.module_key, v_transition.permission) then
        return 'forbidden';
      end if;
      if v_transition.kind = 'return' and v_reason is null then
        return 'reason_required';
      end if;

      -- The next holder (§3): the raiser, as the Step is its own role's. Coming
      -- back by Return, the person who held that Step before, if still in its pool;
      -- otherwise the pool, which must not be empty.
      if not exists (select 1 from app.step_pool(p_work_item_id, v_transition.to_step_id, v_raiser.id)) then
        return 'no_step_pool';
      end if;
      if v_transition.kind = 'return' then
        select a.assignee_member_id into v_holder from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_transition.to_step_id and a.status = 'done'
          and a.assignee_member_id in (
            select member_id from app.step_pool(p_work_item_id, v_transition.to_step_id, v_raiser.id))
        order by a.done_at desc, a.id desc limit 1;
      end if;

      -- Effects, in order.
      if v_item.document_number is null and v_transition.from_draft then
        v_prefix := concat_ws('-', v_item.project_code, v_item.type_code,
          lpad(v_raiser.ordinal::text, greatest(2, length(v_raiser.ordinal::text)), '0'));
        insert into numbering_counter as c (project_id, counter_key, last_value)
        values (v_item.project_id, v_prefix, 1)
        on conflict (project_id, counter_key) do update set last_value = c.last_value + 1
        returning last_value into v_seq;
        v_number := v_prefix || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
      end if;

      v_audience := case
        when v_transition.kind in ('submit', 'close') or v_transition.from_outcome_mode = 'issue_code' then 'shared'
        else 'internal' end;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, audience_participant_id, content_sha256, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'transition', v_member_id, v_me.participant_id, v_transition.id,
        v_item.current_step_id, v_transition.to_step_id,
        jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'document_number', v_number)),
        v_audience, case when v_audience = 'internal' then v_me.participant_id end,
        sha256(convert_to(jsonb_build_object('title', v_item.title, 'data', v_item.data)::text, 'UTF8')),
        v_at
      );

      update step_assignment set status = 'done', done_at = v_at, updated_at = v_at where id = v_assignment.id;

      update work_item set
        current_step_id = v_transition.to_step_id,
        current_stage_key = v_transition.to_stage_key,
        step_entered_at = v_at,
        document_number = coalesce(document_number, v_number),
        updated_at = v_at
      where id = p_work_item_id;

      insert into step_assignment (
        project_id, work_item_id, step_id, participant_id, assignee_member_id, status, claimed_at, created_at, updated_at
      ) values (
        v_item.project_id, p_work_item_id, v_transition.to_step_id, v_raiser.id, v_holder,
        case when v_holder is null then 'pooled' else 'claimed' end,
        case when v_holder is null then null else v_at end, v_at, v_at
      );
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (p_work_item_id, v_item.project_id, v_raiser.id, v_at, 'handling')
      on conflict do nothing;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- Claims the item's pooled Step for the acting Member (§5.2). The item row is
-- locked, so of two simultaneous Claims one wins and the other finds it taken.
-- Outcome: 'claimed' (also when they already hold it), 'not_found', 'item_closed',
-- 'project_closed', 'already_claimed' (someone else in their Participant holds it)
-- or 'forbidden' (another Participant's Step, or not in its pool).
create function app.claim_step(p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_assignment record;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      select * into v_assignment from step_assignment
      where work_item_id = p_work_item_id and status in ('pooled', 'claimed', 'vacant');
      -- Another Participant's Step: whether it is claimed is internal to them (§5.2).
      if v_assignment.participant_id is distinct from v_me.participant_id then
        return 'forbidden';
      end if;
      if v_assignment.status = 'claimed' then
        return case when v_assignment.assignee_member_id = app.current_member_id() then 'claimed' else 'already_claimed' end;
      end if;
      if v_assignment.status <> 'pooled' or v_me.project_member_id not in (
        select project_member_id from app.step_pool(p_work_item_id, v_assignment.step_id, v_assignment.participant_id))
      then
        return 'forbidden';
      end if;

      update step_assignment
      set status = 'claimed', assignee_member_id = app.current_member_id(), claimed_at = v_at, updated_at = v_at
      where id = v_assignment.id and status = 'pooled';
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'claimed', app.current_member_id(), v_me.participant_id,
        'internal', v_me.participant_id, v_at
      );
      return 'claimed';
    end
  $$;

-- Whether the Step is a Workflow's Draft start (its Stage's category is draft).
create function app.is_draft_step(p_step_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select exists (
      select 1 from workflow_step s
      join workflow_version v on v.id = s.workflow_version_id
      join work_item_type t on t.workflow_definition_id = v.workflow_definition_id
      join stage st on st.owner_kind = 'rabaed' and st.module_key = t.module_key and st.key = s.stage_key
      where s.id = p_step_id and st.category = 'draft'
    )
  $$;

-- Returns the Step the acting Member claimed to its pool (§5.2); a Draft stays
-- with its holder. Outcome: 'released', 'not_found', 'item_closed',
-- 'project_closed' or 'not_holder'.
create function app.release_step(p_work_item_id uuid, p_now timestamptz) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
      v_item record;
      v_me record;
      v_assignment_id uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      select w.id, w.project_id, w.closed_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id
      for update of w;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return 'not_found';
      end if;
      if v_item.closed_at is not null then
        return 'item_closed';
      end if;
      if v_item.project_status <> 'active' then
        return 'project_closed';
      end if;
      update step_assignment a
      set status = 'pooled', assignee_member_id = null, claimed_at = null, updated_at = v_at
      where a.work_item_id = p_work_item_id and a.status = 'claimed' and a.assignee_member_id = app.current_member_id()
        and not app.is_draft_step(a.step_id)
      returning a.id into v_assignment_id;
      if v_assignment_id is null then
        return 'not_holder';
      end if;
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, audience, audience_participant_id, created_at
      ) values (
        v_item.project_id, p_work_item_id, 'released', app.current_member_id(), v_me.participant_id,
        'internal', v_me.participant_id, v_at
      );
      return 'released';
    end
  $$;

-- What the acting Member may press on the item now: 'claim' (a pooled Step whose
-- pool they are in), 'release' (a Step they claimed) and each takeable Transition.
create function app.work_item_actions(p_work_item_id uuid)
  returns table (action text, transition_key text, label jsonb, transition_kind text)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
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
    ) x
  $$;

-- The item's history the acting Member may see: its events through RLS (internal
-- ones only for their own Participant, layer 5), with each actor's Company name
-- and, within their own Company only, the person's name (V14).
create function app.work_item_history(p_work_item_id uuid)
  returns table (
    seq integer, type text, created_at timestamptz, audience text, company_name jsonb, member_name jsonb,
    transition_label jsonb, from_step_name jsonb, to_step_name jsonb, reason text, document_number text
  )
  language sql stable security invoker
  set search_path = pg_catalog, public
  as $$
    select e.seq, e.type, e.created_at, e.audience, actor.legal_name, m.full_name,
      tr.label, fs.name, ts.name, e.payload ->> 'reason', e.payload ->> 'document_number'
    from work_item_event e
    join work_item w on w.id = e.work_item_id
    left join app.project_participants(w.project_id) actor on actor.participant_id = e.actor_participant_id
    left join member m on m.id = e.actor_member_id
    left join workflow_transition tr on tr.id = e.transition_id
    left join workflow_step fs on fs.id = e.from_step_id
    left join workflow_step ts on ts.id = e.to_step_id
    where e.work_item_id = p_work_item_id
    order by e.seq
  $$;

revoke all on function
  app.set_project_member_positions(uuid, uuid, text[]),
  app.number_participant(),
  app.project_member_has_permission(uuid, text, text),
  app.step_pool(uuid, uuid, uuid),
  app.acting_project_member(uuid),
  app.takeable_transitions(uuid),
  app.take_transition(uuid, text, text, uuid, timestamptz),
  app.claim_step(uuid, timestamptz),
  app.is_draft_step(uuid),
  app.release_step(uuid, timestamptz),
  app.work_item_actions(uuid),
  app.work_item_history(uuid)
  from public;
grant execute on function
  app.set_project_member_positions(uuid, uuid, text[]),
  app.take_transition(uuid, text, text, uuid, timestamptz),
  app.claim_step(uuid, timestamptz),
  app.release_step(uuid, timestamptz),
  app.work_item_actions(uuid),
  app.work_item_history(uuid)
  to rabaed_app;
