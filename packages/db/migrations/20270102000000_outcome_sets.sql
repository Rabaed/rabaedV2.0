-- Outcome sets per Work Item Type (RP-429, WF-6; spec RP-423; glossary Outcome;
-- workflow-engine.md §1 "Outcomes", §6; data-model.md outcome).
--
-- * outcome: each Work Item Type's ordered set of outcomes: a code, an English and
--   Arabic name, whether it closes the item, positive or negative, and follow-up
--   actions (`create_items` of a Type, `offer_revision`, `offer_replacement`), as
--   @rabaed/domain's outcome.ts has them. A Rabaed Default Type's set is Rabaed's
--   (owner 'rabaed'); every Project runs its own copy of it (owner 'project'), as
--   it runs its own Stages: copied when the Project is created (trigger
--   project_outcomes), when a Rabaed Default outcome is added (trigger
--   outcome_rabaed_default_copied, also for a new Rabaed Default Type's set), and
--   backfilled here. A Project's own Type has its set on that Project only. A new
--   Type starts with the Rabaed Default set of its outcome_kind
--   (app.default_outcomes, trigger work_item_type_outcomes), which gains
--   'approval' (Approved, Rejected).
-- * Rabaed Defaults never change in place. A Project Admin adds outcomes to the
--   Project's copy (app.add_outcome), changes their names and follow-up actions
--   (app.change_outcome) and their order (app.reorder_outcomes), each audited in
--   project_event, as the Stage commands are. An outcome keeps its code, closing
--   and polarity once added: closed items and published Workflows rely on them.
--   Nothing deletes one.
-- * Visibility: an outcome is read like its Type (policy member_reads_outcomes,
--   the same rule as member_reads_work_item_types): a Rabaed Default set by every
--   Member, a Project's copy by its Project Members only. The app role writes
--   none directly. Nothing else widens.
-- * An item's outcome is a closing outcome of its Type's set on its Project, or
--   'cancelled' (trigger work_item_outcome_in_set, for every writer:
--   app.take_transition sets the outcome its closing Transition names, which
--   publish check 3 keeps to the Type's set). The fixed checks on
--   work_item.outcome and workflow_transition.outcome give way to the code's shape.
-- * Follow-up actions are read by: app.outcome_offers (any action kind, by
--   Project, Type and code), app.work_item_outcome_actions (the actions of the
--   outcome a closed item the caller sees ended with: WF-11's items to create,
--   WF-12's replacement) and app.can_create_revision (Code C's Revision is now an
--   outcome offering a Revision).

-- The table ------------------------------------------------------------------------

-- Whether `p_actions` is a list of follow-up actions: each one of the three kinds,
-- at most once, `create_items` naming a Type code. outcome.ts `outcomeActions` is its copy.
create function app.is_outcome_actions(p_actions jsonb) returns boolean
  language plpgsql immutable
  as $$
    begin
      if p_actions is null or jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) > 3 then
        return false;
      end if;
      if exists (
        select 1 from jsonb_array_elements(p_actions) e
        where jsonb_typeof(e) <> 'object'
          or not (
            (e ->> 'kind' in ('offer_revision', 'offer_replacement') and e - 'kind' = '{}'::jsonb)
            or (e ->> 'kind' = 'create_items' and jsonb_typeof(e -> 'type') = 'string'
              and e ->> 'type' ~ '^[A-Z]{2,6}$' and e - 'kind' - 'type' = '{}'::jsonb)
          )
      ) then
        return false;
      end if;
      return (select count(distinct e ->> 'kind') from jsonb_array_elements(p_actions) e) = jsonb_array_length(p_actions);
    end
  $$;
revoke all on function app.is_outcome_actions(jsonb) from public;

-- Whether `p_code` is an outcome code a set may hold (outcome.ts `outcomeCode`).
create function app.is_outcome_code(p_code text) returns boolean
  language sql immutable
  as $$ select p_code ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$' and p_code not in ('cancelled', 'pending', 'in_preparation') $$;
revoke all on function app.is_outcome_code(text) from public;
-- Plain helpers of the checks below, for whichever role writes the rows (as app.is_bilingual).
grant execute on function app.is_outcome_actions(jsonb), app.is_outcome_code(text) to rabaed_app, rabaed_admin;

create table outcome (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('rabaed', 'project')),
  project_id uuid references project (id),
  work_item_type_id uuid not null references work_item_type (id),
  code text not null check (app.is_outcome_code(code)),
  name jsonb not null check (app.is_bilingual(name)),
  closing boolean not null,
  polarity text not null check (polarity in ('positive', 'negative')),
  actions jsonb not null default '[]' check (app.is_outcome_actions(actions)),
  sort integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_kind = 'rabaed') = (project_id is null))
);
create unique index outcome_rabaed_key on outcome (work_item_type_id, code) where owner_kind = 'rabaed';
create unique index outcome_project_key on outcome (project_id, work_item_type_id, code) where owner_kind = 'project';

alter table outcome enable row level security;
revoke insert, update, delete, truncate on outcome from rabaed_app;
-- Read like the Type it belongs to (member_reads_work_item_types).
create policy member_reads_outcomes on outcome for select to rabaed_app
  using (
    (project_id is null and app.current_company_id() is not null)
    or project_id in (select app.current_project_ids())
  );

alter table work_item_type drop constraint work_item_type_outcome_kind_check;
alter table work_item_type add constraint work_item_type_outcome_kind_check
  check (outcome_kind in ('review_code', 'inspection_result', 'approval', 'none'));

-- An outcome is a code of its Type's set (checked below and at publish), not a fixed list.
alter table work_item drop constraint work_item_outcome_check;
alter table work_item add constraint work_item_outcome_check check (outcome ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$');
alter table workflow_transition drop constraint workflow_transition_outcome_check;
alter table workflow_transition add constraint workflow_transition_outcome_check check (app.is_outcome_code(outcome));

-- The Rabaed Default sets ------------------------------------------------------------

-- The Rabaed Default set of an outcome kind, in order. outcome.ts `defaultOutcomeSets`
-- is its copy (seam-2 outcome-sets.test.ts checks they agree). `CMT` is the Snag
-- List's Comment Type (WF-11): Code B's action items become Comments.
create function app.default_outcomes(p_kind text)
  returns table (code text, name jsonb, closing boolean, polarity text, actions jsonb, sort integer)
  language sql immutable
  as $$
    select d.code, d.name::jsonb, true, d.polarity, d.actions::jsonb, d.sort
    from (values
      ('review_code', 'A', '{"en": "Approved", "ar": "معتمد"}', 'positive', '[]', 1),
      ('review_code', 'B', '{"en": "Approved with Comments", "ar": "معتمد مع ملاحظات"}', 'positive',
        '[{"kind": "create_items", "type": "CMT"}]', 2),
      ('review_code', 'C', '{"en": "Revise and Resubmit", "ar": "يُراجع ويُعاد تقديمه"}', 'negative', '[{"kind": "offer_revision"}]', 3),
      ('review_code', 'D', '{"en": "Rejected", "ar": "مرفوض"}', 'negative', '[{"kind": "offer_replacement"}]', 4),
      ('inspection_result', 'passed', '{"en": "Passed", "ar": "ناجح"}', 'positive', '[]', 1),
      ('inspection_result', 'passed_with_comments', '{"en": "Passed with Comments", "ar": "ناجح مع ملاحظات"}', 'positive', '[]', 2),
      ('inspection_result', 'failed', '{"en": "Failed", "ar": "راسب"}', 'negative', '[]', 3),
      ('approval', 'approved', '{"en": "Approved", "ar": "معتمد"}', 'positive', '[]', 1),
      ('approval', 'rejected', '{"en": "Rejected", "ar": "مرفوض"}', 'negative', '[]', 2),
      ('none', 'closed', '{"en": "Closed", "ar": "مغلق"}', 'positive', '[]', 1)
    ) as d (kind, code, name, polarity, actions, sort)
    where d.kind = p_kind
    order by d.sort
  $$;
revoke all on function app.default_outcomes(text) from public;

-- Seeding ------------------------------------------------------------------------

-- A new Type starts with the Rabaed Default set of its outcome kind, owned as the Type is.
create function app.seed_type_outcomes() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
      select new.owner_kind, new.project_id, new.id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
      from app.default_outcomes(new.outcome_kind) d;
      return new;
    end
  $$;
revoke all on function app.seed_type_outcomes() from public;
create trigger work_item_type_outcomes after insert on work_item_type
  for each row execute function app.seed_type_outcomes();

-- The Rabaed Default outcomes a Project doesn't have yet (by Type and code), as its own.
create function app.copy_rabaed_outcomes(p_project_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
      select 'project', p_project_id, d.work_item_type_id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
      from outcome d
      where d.owner_kind = 'rabaed'
        and not exists (
          select 1 from outcome x
          where x.project_id = p_project_id and x.work_item_type_id = d.work_item_type_id and x.code = d.code
        )
      order by d.work_item_type_id, d.sort;
    end
  $$;
revoke all on function app.copy_rabaed_outcomes(uuid) from public;

create function app.create_project_outcomes() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.copy_rabaed_outcomes(new.id);
      return new;
    end
  $$;
revoke all on function app.create_project_outcomes() from public;
create trigger project_outcomes after insert on project
  for each row execute function app.create_project_outcomes();

create function app.copy_rabaed_outcome_to_projects() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
      select 'project', p.id, new.work_item_type_id, new.code, new.name, new.closing, new.polarity, new.actions, new.sort
      from project p
      where not exists (
        select 1 from outcome x where x.project_id = p.id and x.work_item_type_id = new.work_item_type_id and x.code = new.code
      );
      return new;
    end
  $$;
revoke all on function app.copy_rabaed_outcome_to_projects() from public;
create trigger outcome_rabaed_default_copied after insert on outcome
  for each row when (new.owner_kind = 'rabaed') execute function app.copy_rabaed_outcome_to_projects();

-- The backfill: every Type's set (a Rabaed Default one copied into every Project by the trigger above).
insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
select t.owner_kind, t.project_id, t.id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
from work_item_type t
cross join lateral app.default_outcomes(t.outcome_kind) d
order by t.created_at, t.id, d.sort;

-- Reads ----------------------------------------------------------------------------

-- Whether outcome `p_code` of Type `p_type_id`'s set on Project `p_project_id` has a
-- follow-up action of kind `p_action` ('create_items', 'offer_revision',
-- 'offer_replacement'). Invoker: the app role reads only what its policy lets it.
create function app.outcome_offers(p_project_id uuid, p_type_id uuid, p_code text, p_action text) returns boolean
  language sql stable
  as $$
    select coalesce((
      select o.actions @> jsonb_build_array(jsonb_build_object('kind', p_action))
      from outcome o
      where o.project_id = p_project_id and o.work_item_type_id = p_type_id and o.code = p_code
    ), false)
  $$;
revoke all on function app.outcome_offers(uuid, uuid, text, text) from public;
grant execute on function app.outcome_offers(uuid, uuid, text, text) to rabaed_app;

-- The follow-up actions of the outcome item `p_work_item_id` ended with, for a caller
-- who sees it ('[]' for an open item, a cancelled one, or one the caller doesn't
-- see). WF-11 reads `create_items`, WF-12 `offer_replacement`.
create function app.work_item_outcome_actions(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return '[]'::jsonb;
      end if;
      return coalesce((
        select o.actions
        from work_item w
        join outcome o on o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.code = w.outcome
        where w.id = p_work_item_id
      ), '[]'::jsonb);
    end
  $$;
revoke all on function app.work_item_outcome_actions(uuid) from public;
grant execute on function app.work_item_outcome_actions(uuid) to rabaed_app;

-- An item's outcome is a closing outcome of its Type's set on its Project, or 'cancelled'.
create function app.check_work_item_outcome() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if new.outcome is not null and new.outcome <> 'cancelled'
        and (tg_op = 'INSERT' or new.outcome is distinct from old.outcome)
        and not exists (
          select 1 from outcome o
          where o.project_id = new.project_id and o.work_item_type_id = new.work_item_type_id
            and o.code = new.outcome and o.closing
        )
      then
        raise exception 'outcome % is not a closing outcome of the item''s Work Item Type', new.outcome
          using errcode = '23514';
      end if;
      return new;
    end
  $$;
revoke all on function app.check_work_item_outcome() from public;
create trigger work_item_outcome_in_set before insert or update of outcome on work_item
  for each row execute function app.check_work_item_outcome();

-- As in 20261108000000_plpgsql_definer_helpers.sql, but the closed item's outcome
-- offers a Revision (Code C in the Rabaed Defaults) in its Type's set on the Project.
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
            and app.outcome_offers(w.project_id, w.work_item_type_id, w.outcome, 'offer_revision') and w.discarded_at is null
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

-- The Project Admin's commands ---------------------------------------------------------

alter table project_event drop constraint project_event_type_check;
alter table project_event add constraint project_event_type_check
  check (type in ('stage_added', 'stage_renamed', 'stages_reordered', 'stage_removed', 'outcome_added', 'outcome_changed', 'outcomes_reordered'));

-- The Type of code `p_type_code` the Project uses: its own Type of that code, else the Rabaed Default one.
create function app.project_type_id(p_project_id uuid, p_type_code text) returns uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select t.id from work_item_type t
        where t.code = p_type_code and (t.project_id = p_project_id or t.project_id is null)
        order by t.project_id is null, t.id
        limit 1
      );
    end
  $$;
revoke all on function app.project_type_id(uuid, text) from public;

-- Common to every command: 'not_found' unless the acting Member is a Project Admin of
-- the Project (whether it exists or not, so it names nothing) and the Project uses a
-- Type of that code; 'project_closed'. Takes the Project's lock on the Type's set, so
-- two commands on it never interleave.
create function app.outcome_command_refusal(p_project_id uuid, p_type_id uuid) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if p_type_id is null or not exists (select 1 from app.current_admin_project_ids() x where x = p_project_id) then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('outcomes:' || p_project_id::text || ':' || p_type_id::text, 0));
      return null;
    end
  $$;
revoke all on function app.outcome_command_refusal(uuid, uuid) from public;

-- Outcome: 'added' (last in the set's order); 'not_found'; 'project_closed';
-- 'invalid_outcome' (a code a set can't hold, a name without English and Arabic, no
-- closing or polarity, actions that aren't follow-up actions); 'outcome_exists'.
create function app.add_outcome(
  p_project_id uuid, p_type_code text, p_code text, p_name jsonb, p_closing boolean, p_polarity text, p_actions jsonb
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type uuid := app.project_type_id(p_project_id, p_type_code);
      v_refusal text := app.outcome_command_refusal(p_project_id, v_type);
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      if not coalesce(app.is_outcome_code(p_code), false) or not coalesce(app.is_bilingual(p_name), false)
        or p_closing is null or p_polarity is null or p_polarity not in ('positive', 'negative')
        or not coalesce(app.is_outcome_actions(p_actions), false)
      then
        return 'invalid_outcome';
      end if;
      if exists (select 1 from outcome where project_id = p_project_id and work_item_type_id = v_type and code = p_code) then
        return 'outcome_exists';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
      select 'project', p_project_id, v_type, p_code, p_name, p_closing, p_polarity, p_actions, coalesce(max(o.sort), 0) + 1
      from outcome o where o.project_id = p_project_id and o.work_item_type_id = v_type;
      perform app.write_project_event(p_project_id, 'outcome_added', jsonb_build_object(
        'type', p_type_code, 'code', p_code, 'name', p_name, 'closing', p_closing, 'polarity', p_polarity, 'actions', p_actions));
      return 'added';
    end
  $$;
revoke all on function app.add_outcome(uuid, text, text, jsonb, boolean, text, jsonb) from public;
grant execute on function app.add_outcome(uuid, text, text, jsonb, boolean, text, jsonb) to rabaed_app;

-- Outcome: 'changed' (its names and follow-up actions; its code, closing and
-- polarity stay); 'not_found' (also a code the set doesn't have); 'project_closed';
-- 'invalid_outcome'.
create function app.change_outcome(p_project_id uuid, p_type_code text, p_code text, p_name jsonb, p_actions jsonb) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type uuid := app.project_type_id(p_project_id, p_type_code);
      v_refusal text := app.outcome_command_refusal(p_project_id, v_type);
      v_outcome outcome;
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select * into v_outcome from outcome where project_id = p_project_id and work_item_type_id = v_type and code = p_code;
      if v_outcome.id is null then
        return 'not_found';
      end if;
      if not coalesce(app.is_bilingual(p_name), false) or not coalesce(app.is_outcome_actions(p_actions), false) then
        return 'invalid_outcome';
      end if;
      p_name := jsonb_build_object('en', trim(p_name ->> 'en'), 'ar', trim(p_name ->> 'ar'));
      update outcome set name = p_name, actions = p_actions, updated_at = now() where id = v_outcome.id;
      perform app.write_project_event(p_project_id, 'outcome_changed', jsonb_build_object(
        'type', p_type_code, 'code', p_code,
        'from', jsonb_build_object('name', v_outcome.name, 'actions', v_outcome.actions),
        'to', jsonb_build_object('name', p_name, 'actions', p_actions)));
      return 'changed';
    end
  $$;
revoke all on function app.change_outcome(uuid, text, text, jsonb, jsonb) from public;
grant execute on function app.change_outcome(uuid, text, text, jsonb, jsonb) to rabaed_app;

-- Outcome: 'reordered'; 'not_found'; 'project_closed'; 'invalid_order' (not exactly
-- the set's codes, each once).
create function app.reorder_outcomes(p_project_id uuid, p_type_code text, p_codes text[]) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_type uuid := app.project_type_id(p_project_id, p_type_code);
      v_refusal text := app.outcome_command_refusal(p_project_id, v_type);
      v_before text[];
    begin
      if v_refusal is not null then
        return v_refusal;
      end if;
      select array_agg(code order by sort, code) into v_before
      from outcome where project_id = p_project_id and work_item_type_id = v_type;
      if p_codes is null or cardinality(p_codes) <> coalesce(cardinality(v_before), 0)
        or (select count(distinct c) from unnest(p_codes) c) <> cardinality(p_codes)
        or exists (select 1 from unnest(p_codes) c where c is null or c <> all(v_before))
      then
        return 'invalid_order';
      end if;
      update outcome o set sort = n.n, updated_at = now()
      from unnest(p_codes) with ordinality as n (code, n)
      where o.project_id = p_project_id and o.work_item_type_id = v_type and o.code = n.code and o.sort <> n.n;
      perform app.write_project_event(p_project_id, 'outcomes_reordered',
        jsonb_build_object('type', p_type_code, 'from', to_jsonb(v_before), 'to', to_jsonb(p_codes)));
      return 'reordered';
    end
  $$;
revoke all on function app.reorder_outcomes(uuid, text, text[]) from public;
grant execute on function app.reorder_outcomes(uuid, text, text[]) to rabaed_app;
