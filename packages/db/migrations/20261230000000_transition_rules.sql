-- Transition rules at run time: Restrict and Validate (RP-430, WF-7; spec RP-423;
-- workflow-engine.md §1 "Definition format", §4, §5.1; visibility.md "Refusals of
-- a Transition", scenarios RP-430-1 to RP-430-3).
--
-- * workflow_transition.rules: a Transition's rules as the definition format has
--   them (`{ "restrict": [...], "validate": [...] }`, workflow-definition.ts),
--   null when it has none. Published Versions keep null: adding the column changes
--   no row, so the frozen-Version guard (RP-424) has nothing to refuse.
-- * app.condition_holds: the condition language (§4) in SQL, the same rule as
--   @rabaed/domain's evaluateCondition, run over the same cases
--   (condition-cases.json). A `field` reads the Action Form answer first, else the
--   Form's; an `attr` reads the item's attributes (app.work_item_rule_attrs).
-- * The rules step, kept apart from app.take_transition so WF-8 and later
--   redefinitions call it unchanged: app.transition_rules routes among the
--   Transitions sharing a label and source Step (exactly one must match, else
--   'no_route'), then checks the chosen one's Restrict ('transition_not_available',
--   the answer for a Transition that isn't there) and Validate
--   ('validation_failed:<n>', n the rule's place in `validate`, from 0).
-- * Everything a rule reads is what the acting Member may read, so a refusal never
--   differs by hidden data: answers through app.work_item_answers (ADR 0012);
--   "not the same person" and "been through" only events of the item shared with
--   every Participant or internal to the acting one (V5, V14); "all closed" and
--   "has a Document" only items and Documents the acting Member sees.
-- * "Form complete" is the Form engine's completeness (validateAnswers, in
--   TypeScript, with conditional required, tables, checklists and files): the API
--   checks it before calling take_transition, as it checks the sections a Step
--   leaves (p_checked_data_sha256). The database skips it.
-- * app.takeable_transitions: as the plpgsql_definer_helpers migration left it,
--   offering a Transition only when its Restrict holds, and a label shared by
--   several Transitions once (the first by sort), its route chosen when taken.
-- * app.take_transition: as the send_back migration left it, with the rules step
--   after the Transition is found; a routed Transition replaces the one asked for.
-- * app.transition_route: the Transition a label's answers route to, for the API
--   to check the Action Form and "Form complete" of the one that will be taken.

alter table workflow_transition add column rules jsonb
  check (rules is null or (jsonb_typeof(rules) = 'object'
    and coalesce(jsonb_typeof(rules -> 'restrict'), 'array') = 'array'
    and coalesce(jsonb_typeof(rules -> 'validate'), 'array') = 'array'));

-- The condition language -------------------------------------------------------------

-- No answer: nothing, empty text, or no option chosen. `false` is an answer (No).
create function app.is_unanswered(p_value jsonb) returns boolean
  language sql immutable
  set search_path = pg_catalog, public
  as $$
    select p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
  $$;

-- How `p_actual` orders against `p_expected`: -1, 0 or 1 for two numbers, or two ISO
-- values of one kind (dates, times of day, UTC instants); null for anything else.
create function app.condition_order(p_actual jsonb, p_expected jsonb) returns integer
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    declare
      v_a text;
      v_b text;
    begin
      if jsonb_typeof(p_actual) = 'number' and jsonb_typeof(p_expected) = 'number' then
        return sign((p_actual #>> '{}')::numeric - (p_expected #>> '{}')::numeric)::integer;
      end if;
      if jsonb_typeof(p_actual) is distinct from 'string' or jsonb_typeof(p_expected) is distinct from 'string' then
        return null;
      end if;
      v_a := p_actual #>> '{}';
      v_b := p_expected #>> '{}';
      if v_a ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and v_b ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        return case when v_a collate "C" < v_b collate "C" then -1 when v_a collate "C" > v_b collate "C" then 1 else 0 end;
      end if;
      if v_a ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' and v_b ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
        v_a := case when length(v_a) = 5 then v_a || ':00' else v_a end;
        v_b := case when length(v_b) = 5 then v_b || ':00' else v_b end;
        return case when v_a collate "C" < v_b collate "C" then -1 when v_a collate "C" > v_b collate "C" then 1 else 0 end;
      end if;
      if v_a ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' and v_b ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then
        begin
          return sign(extract(epoch from v_a::timestamptz) - extract(epoch from v_b::timestamptz))::integer;
        exception when others then
          return null;
        end;
      end if;
      return null;
    end
  $$;

-- Whether condition `p_rule` holds for the Form answers `p_fields`, the Action Form
-- answers `p_action` (null: none) and the item attributes `p_attrs` (§4). The same
-- rule as evaluateCondition (@rabaed/domain condition.ts).
create function app.condition_holds(p_rule jsonb, p_fields jsonb, p_action jsonb, p_attrs jsonb) returns boolean
  language plpgsql immutable
  set search_path = pg_catalog, public
  as $$
    declare
      v_op text := p_rule ->> 'op';
      v_value jsonb := p_rule -> 'value';
      v_actual jsonb;
      v_found boolean;
      v_order integer;
    begin
      if p_rule ? 'all' then
        return coalesce((
          select bool_and(app.condition_holds(r, p_fields, p_action, p_attrs)) from jsonb_array_elements(p_rule -> 'all') r), true);
      elsif p_rule ? 'any' then
        return coalesce((
          select bool_or(app.condition_holds(r, p_fields, p_action, p_attrs)) from jsonb_array_elements(p_rule -> 'any') r), false);
      elsif p_rule ? 'not' then
        return not app.condition_holds(p_rule -> 'not', p_fields, p_action, p_attrs);
      end if;

      v_actual := case
        when p_rule ? 'field' and coalesce(p_action ? (p_rule ->> 'field'), false) then p_action -> (p_rule ->> 'field')
        when p_rule ? 'field' then p_fields -> (p_rule ->> 'field')
        else p_attrs -> (p_rule ->> 'attr') end;

      if v_op in ('empty', 'not_empty') then
        return app.is_unanswered(v_actual) = (v_op = 'empty');
      elsif v_op in ('=', '!=') then
        if jsonb_typeof(v_actual) = 'array' or jsonb_typeof(v_value) = 'array' then
          -- A multi-select: the same options, in any order.
          v_found := jsonb_typeof(v_actual) = 'array' and jsonb_typeof(v_value) = 'array'
            and jsonb_array_length(v_actual) = jsonb_array_length(v_value) and v_value @> v_actual;
        else
          v_found := coalesce(v_actual = v_value, false);
        end if;
        return v_found = (v_op = '=');
      elsif v_op in ('in', 'not_in') then
        -- A multi-select is in the list when any of its options is.
        v_found := case
          when jsonb_typeof(v_actual) = 'array' then exists (
            select 1 from jsonb_array_elements(v_actual) a where v_value @> jsonb_build_array(a))
          else v_actual is not null and v_value @> jsonb_build_array(v_actual) end;
        return v_found = (v_op = 'in');
      end if;
      v_order := app.condition_order(v_actual, v_value);
      if v_order is null then
        return false;
      end if;
      return case v_op
        when '>' then v_order > 0 when '>=' then v_order >= 0
        when '<' then v_order < 0 when '<=' then v_order <= 0
        else false end;
    end
  $$;

-- The attributes a rule may read of an item (workflowRuleAttrs): its Trade's and
-- Location's codes, its Work Item Type's code and its revision_no. Whoever sees
-- the item sees all four.
create function app.work_item_rule_attrs(p_work_item_id uuid) returns jsonb
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select jsonb_build_object(
          'trade', (select dv.code from work_item_dimension_value wv
                    join visibility_dimension d on d.id = wv.dimension_id
                    join dimension_value dv on dv.id = wv.dimension_value_id
                    where wv.work_item_id = w.id and d.kind = 'trade'),
          'location', (select dv.code from work_item_dimension_value wv
                       join visibility_dimension d on d.id = wv.dimension_id
                       join dimension_value dv on dv.id = wv.dimension_value_id
                       where wv.work_item_id = w.id and d.kind = 'location'),
          'work_item_type', t.code,
          'revision_no', w.revision_no)
        from work_item w
        join work_item_type t on t.id = w.work_item_type_id
        where w.id = p_work_item_id
      );
    end
  $$;

-- The rules step ---------------------------------------------------------------------

-- Whether every Restrict condition of `p_rules` holds on the item, as the acting
-- Member reads its answers, with the Action Form answers `p_answers` ('{}' before
-- the pop-up is filled).
create function app.transition_conditions_hold(p_work_item_id uuid, p_rules jsonb, p_answers jsonb) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_fields jsonb;
      v_attrs jsonb;
    begin
      if not exists (select 1 from jsonb_array_elements(coalesce(p_rules -> 'restrict', '[]')) r where r ->> 'type' = 'condition') then
        return true;
      end if;
      v_fields := coalesce(app.work_item_answers(p_work_item_id), '{}');
      v_attrs := app.work_item_rule_attrs(p_work_item_id);
      return not exists (
        select 1 from jsonb_array_elements(p_rules -> 'restrict') r
        where r ->> 'type' = 'condition' and not app.condition_holds(r -> 'condition', v_fields, p_answers, v_attrs));
    end
  $$;

-- Whether the Restrict rules of `p_rules` other than conditions hold for the acting
-- Member (`p_project_member_id`, of `p_participant_id`). Each reads only what that
-- Member may read: the item's events shared with every Participant or internal to
-- theirs, and the Subtasks and Comments they see.
create function app.transition_restrictions_hold(
  p_work_item_id uuid, p_rules jsonb, p_project_member_id uuid, p_participant_id uuid
) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_rule jsonb;
      v_version uuid;
      v_member uuid := app.current_member_id();
    begin
      select workflow_version_id into v_version from work_item where id = p_work_item_id;
      for v_rule in select r from jsonb_array_elements(coalesce(p_rules -> 'restrict', '[]')) r loop
        case v_rule ->> 'type'
          -- Who may take it: one of these Positions.
          when 'positions' then
            if not exists (
              select 1 from project_member_position mp join position p on p.id = mp.position_id
              where mp.project_member_id = p_project_member_id
                and p.key in (select jsonb_array_elements_text(v_rule -> 'positions')))
            then
              return false;
            end if;
          -- Separation of duties: not the Member who left that Step, or took that Transition.
          when 'not_same_person' then
            if exists (
              select 1 from work_item_event e
              where e.work_item_id = p_work_item_id and e.type in ('transition', 'issue_code')
                and e.actor_member_id = v_member
                and (e.audience = 'shared' or e.audience_participant_id = p_participant_id)
                and case when v_rule ? 'step'
                  then e.from_step_id = (select s.id from workflow_step s where s.workflow_version_id = v_version and s.key = v_rule ->> 'step')
                  else e.transition_id = (select tr.id from workflow_transition tr
                                          where tr.workflow_version_id = v_version and tr.key = v_rule ->> 'transition') end)
            then
              return false;
            end if;
          -- Has been through a Step (one of the acting Participant's own), or a shared fact.
          when 'been_through' then
            if v_rule ->> 'fact' = 'revision' then
              if not exists (select 1 from work_item w where w.id = p_work_item_id and w.revision_no > 0) then
                return false;
              end if;
            elsif v_rule ->> 'fact' = 'sent_back' then
              if not exists (
                select 1 from work_item_event e join workflow_transition tr on tr.id = e.transition_id
                where e.work_item_id = p_work_item_id and e.type = 'transition' and tr.kind = 'send_back'
                  and (e.audience = 'shared' or e.audience_participant_id = p_participant_id))
              then
                return false;
              end if;
            -- A Step: a move into or out of it, held by the acting Participant. Another
            -- Participant's Step never counts, even where a shared Submit left it.
            elsif not exists (
              select 1 from work_item_event e
              join workflow_step s on s.workflow_version_id = v_version and s.key = v_rule ->> 'step'
              where e.work_item_id = p_work_item_id and e.type in ('transition', 'issue_code')
                and (e.from_step_id = s.id or e.to_step_id = s.id)
                and (e.audience = 'shared' or e.audience_participant_id = p_participant_id)
                and exists (select 1 from step_assignment a
                            where a.work_item_id = p_work_item_id and a.step_id = s.id and a.participant_id = p_participant_id))
            then
              return false;
            end if;
          -- All Comments (items raised from this one) closed: those the Member sees.
          -- Subtasks don't exist yet (no work_item.parent_id): "all Subtasks closed" holds
          -- until they do, and then reads them the same way.
          when 'all_closed' then
            if v_rule ->> 'items' = 'comments' and exists (
              select 1 from work_item_link l
              join work_item c on c.id = l.from_id
              where l.to_id = p_work_item_id and l.kind = 'raised_from' and l.removed_at is null
                and c.closed_at is null and c.discarded_at is null
                and app.sees_work_item(c.id))
            then
              return false;
            end if;
          else
            null;
        end case;
      end loop;
      return true;
    end
  $$;

-- The place in `validate` (from 0) of the first Validate rule of `p_rules` that
-- doesn't hold, with the Action Form answers `p_answers`; null when all hold.
-- "Form complete" is the API's (see the header).
create function app.transition_validation_failed(p_work_item_id uuid, p_rules jsonb, p_answers jsonb) returns integer
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_rule jsonb;
      v_n bigint;
    begin
      for v_rule, v_n in
        select r, n from jsonb_array_elements(coalesce(p_rules -> 'validate', '[]')) with ordinality as x (r, n)
      loop
        if v_rule ->> 'type' = 'condition' and not app.condition_holds(
          v_rule -> 'condition', coalesce(app.work_item_answers(p_work_item_id), '{}'), p_answers, app.work_item_rule_attrs(p_work_item_id))
        then
          return v_n - 1;
        end if;
        -- At least one Document the Member sees: on the item, or in the named field.
        if v_rule ->> 'type' = 'has_document' and not exists (
          select 1 from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and app.item_row_seen(d.work_item_id, d.arrival, false)
            and (not v_rule ? 'field' or d.field_key = v_rule ->> 'field'))
        then
          return v_n - 1;
        end if;
      end loop;
      return null;
    end
  $$;

-- The Transition taking `p_transition_id` takes: itself, unless it shares its label
-- and source Step with others; then the one whose Restrict conditions hold (§4),
-- null when none or several do.
create function app.transition_routed(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb) returns uuid
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_ids uuid[];
    begin
      if not exists (
        select 1 from workflow_transition tr
        join workflow_transition g on g.workflow_version_id = tr.workflow_version_id and g.from_step_id = tr.from_step_id
          and g.label = tr.label and g.id <> tr.id
        where tr.id = p_transition_id)
      then
        return p_transition_id;
      end if;
      select array_agg(g.id) into v_ids
      from workflow_transition tr
      join workflow_transition g on g.workflow_version_id = tr.workflow_version_id and g.from_step_id = tr.from_step_id
        and g.label = tr.label
      where tr.id = p_transition_id and app.transition_conditions_hold(p_work_item_id, g.rules, coalesce(p_answers, '{}'));
      return case when cardinality(v_ids) = 1 then v_ids[1] end;
    end
  $$;

-- The rules step of taking Transition `p_transition_id` with the Action Form
-- answers `p_answers`, for the acting Member: the Transition to take, and the
-- refusal, if any ('no_route', 'transition_not_available', 'validation_failed:<n>').
create function app.transition_rules(p_work_item_id uuid, p_transition_id uuid, p_answers jsonb)
  returns table(transition_id uuid, refusal text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    declare
      v_me record;
      v_chosen uuid;
      v_rules jsonb;
      v_failed integer;
    begin
      select * into v_me from app.acting_project_member(p_work_item_id);
      v_chosen := app.transition_routed(p_work_item_id, p_transition_id, p_answers);
      if v_chosen is null then
        return query select null::uuid, 'no_route'::text;
        return;
      end if;
      select tr.rules into v_rules from workflow_transition tr where tr.id = v_chosen;
      if not app.transition_conditions_hold(p_work_item_id, v_rules, coalesce(p_answers, '{}'))
        or not app.transition_restrictions_hold(p_work_item_id, v_rules, v_me.project_member_id, v_me.participant_id)
      then
        return query select null::uuid, 'transition_not_available'::text;
        return;
      end if;
      v_failed := app.transition_validation_failed(p_work_item_id, v_rules, coalesce(p_answers, '{}'));
      return query select v_chosen, case when v_failed is not null then 'validation_failed:' || v_failed end;
    end
  $$;

-- For the API: the key of the Transition that taking `p_transition_key` with these
-- answers would take (§4), on an item the acting Member sees; null when none.
create function app.transition_route(p_work_item_id uuid, p_transition_key text, p_answers jsonb) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select routed.key
        from work_item w
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
          and tr.key = p_transition_key
        join workflow_transition routed on routed.id = app.transition_routed(w.id, tr.id, p_answers)
        where w.id = p_work_item_id and app.sees_work_item(w.id)
      );
    end
  $$;

-- What the acting Member may press ---------------------------------------------------

-- As in the plpgsql_definer_helpers migration, offering a Transition only when its
-- Restrict holds; Transitions sharing a label and source Step are one button (the
-- first by sort), whose route is chosen when it is taken (its conditions may read
-- the pop-up's answers).
create or replace function app.takeable_transitions(p_work_item_id uuid) returns table(transition_id uuid, key text, label jsonb, kind text, sort integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select distinct on (tr.label) tr.id, tr.key, tr.label, tr.kind, tr.sort
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        cross join lateral app.acting_project_member(w.id) me
        join step_assignment a on a.work_item_id = w.id and a.status = 'claimed'
          and a.assignee_member_id = app.current_member_id() and a.participant_id = me.participant_id
        join workflow_transition tr on tr.workflow_version_id = w.workflow_version_id and tr.from_step_id = w.current_step_id
        where w.id = p_work_item_id and w.closed_at is null
          and app.project_member_has_permission(me.project_member_id, t.module_key, tr.permission)
          and (select h.outcome from app.next_step_holder(w.id, tr.id) h) in ('ok', 'terminal')
          and app.transition_restrictions_hold(w.id, tr.rules, me.project_member_id, me.participant_id)
          and (app.transition_routed(w.id, tr.id, '{}') is distinct from tr.id
            or app.transition_conditions_hold(w.id, tr.rules, '{}'))
        order by tr.label, tr.sort;
    end
  $$;

-- Taking a Transition -----------------------------------------------------------------

-- As in the send_back migration, with the rules step (app.transition_rules) once the
-- Transition is found: a label shared by several Transitions takes the one its
-- answers route to, and a Restrict or Validate that doesn't hold refuses it.
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
      v_rules record;
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
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.*, target.stage_key as to_stage_key,
          source.outcome_mode as from_outcome_mode, app.is_draft_step(source.id) as from_draft
        into v_transition
        from workflow_transition tr
        join workflow_step target on target.id = tr.to_step_id
        join workflow_step source on source.id = tr.from_step_id
        where tr.id = v_rules.transition_id;
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
      -- complete (the row is locked). A cancel, a Return or a Send Back needs no complete Form.
      -- (app.answers_sha256_of without checking again: where it may save, app.answers_open
      -- is app.is_draft_step of the Step its Participant entered at.)
      if v_transition.kind not in ('cancel', 'return', 'send_back') and app.can_save_answers(p_work_item_id)
        and p_checked_data_sha256 is distinct from app.answers_sha256_of(
          p_work_item_id, app.is_draft_step(v_item.participant_entered_step_id))
      then
        return 'form_not_checked';
      end if;

      -- The next holder (§3): the Participant, then, coming back by a Return or a
      -- Send Back, the person who held that Step before if still in its pool;
      -- otherwise the pool.
      select * into v_next from app.next_step_holder(p_work_item_id, v_transition.id);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- Publish checks 4 and 8 keep a Return inside one Participant; never take one across.
      if v_transition.kind = 'return' and v_next.participant_id is distinct from v_me.participant_id then
        raise exception 'Return % crosses Participants', v_transition.key;
      end if;
      if v_transition.kind in ('return', 'send_back') then
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
      -- A Send Back out of a Step of a Participant other than the raiser discards
      -- what it wrote: the sections it fills go back to how they arrived, their
      -- field times too, before the trigger clears the "as arrived" copy (V19, ADR 0013).
      v_data := v_item.data;
      v_times := v_item.field_times;
      if v_transition.kind = 'send_back' and v_crosses and v_me.participant_id <> v_item.raised_by_participant_id
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
      -- Only what crosses is shared (a Send Back always does): a move inside one
      -- Participant stays its own, even from a Step that could issue a Code (V5, V14).
      v_audience := case
        when v_crosses or v_transition.kind in ('submit', 'send_back', 'close') then 'shared'
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
        -- The Creation Date: with the Document Number, at the first exit from Draft.
        numbered_at = case when v_number is not null then coalesce(numbered_at, v_at) else numbered_at end,
        -- The Submission Date: the first Submit out of the raiser's Participant; never changed.
        submitted_at = case
          when v_transition.kind = 'submit' and v_me.participant_id = v_item.raised_by_participant_id
            then coalesce(submitted_at, v_at)
          else submitted_at end,
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

revoke all on function app.is_unanswered(jsonb) from public;
revoke all on function app.condition_order(jsonb, jsonb) from public;
revoke all on function app.condition_holds(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function app.work_item_rule_attrs(uuid) from public;
revoke all on function app.transition_conditions_hold(uuid, jsonb, jsonb) from public;
revoke all on function app.transition_restrictions_hold(uuid, jsonb, uuid, uuid) from public;
revoke all on function app.transition_validation_failed(uuid, jsonb, jsonb) from public;
revoke all on function app.transition_routed(uuid, uuid, jsonb) from public;
revoke all on function app.transition_rules(uuid, uuid, jsonb) from public;
revoke all on function app.transition_route(uuid, text, jsonb) from public;
grant execute on function app.transition_route(uuid, text, jsonb) to rabaed_app;
