-- RP-1108 (decision RP-1004, spec RP-619 stories 10 and 30): any role asks a Question of another
-- (glossary Question; workflow-engine.md §3.1, §5.1 "Informed Participants" and "The Question
-- Types as built"; visibility.md scenarios RP-1108-1 onwards).
--
-- * One Type per role asked: QSN (Question to Consultant) and QSC (Question to Contractor), as
--   before, and a new QSO, Question to Owner. Their Workflows (apps/admin/workflows/QSN.json,
--   QSC.json, QSO.json) hold the Draft by the raiser; `pnpm defaults:publish` publishes QSN's and
--   QSC's Version 2 and QSO's Version 1. Items already raised finish on Version 1.
-- * `work_item_type.asks_role`: the role a Question Type asks. Nobody asks their own role
--   (`app.may_raise_type`): a Contractor is never offered QSC, a Consultant QSN, the Owner and
--   the Owner Representative QSO.
-- * `position_permission.work_item_type_id` (data-model.md: null = the whole Module): the Owner's
--   and the Owner Representative's Positions get `create` in the Snag List for the Question
--   Types only, never for Snags or Site Observations. `app.project_member_has_permission` reads
--   the Module-wide rows only, so every check it makes answers as before; raising a Type reads
--   both (`app.project_member_has_type_permission`).
-- * Their `submit` (to Ask, and to Answer a QSO), `close` (to Close or Ask again) and `attach`
--   (the Question's Attachments) are Module-wide: no Snag List Step names the Owner's roles, and
--   they raise nothing else there, so they hold no other Snag List Step.
-- * `app.next_step_candidates`: the ADR 0022 rule (an Owner Representative covering the item,
--   else the Owner) holds for every Step whose actor rule names the Owner, not only the Owner's
--   review (`confirm_code`), so a QSO's Open lands with the covering Owner Representative.
--   Rebuilt from 20270929000000_participant_pick.sql.
-- * `app.may_raise_type` reads the per-Type `create` and `app.asks_own_role`: rebuilt at the end of
--   this migration, after RP-1089's 20271113000000_may_raise_type.sql.

-- Per-Type Function Permissions -------------------------------------------------------------

alter table work_item_type add constraint work_item_type_id_module_key unique (id, module_key);

alter table position_permission
  add column work_item_type_id uuid,
  add constraint position_permission_type_in_module foreign key (work_item_type_id, module_key)
    references work_item_type (id, module_key);
alter table position_permission drop constraint position_permission_pkey;
alter table position_permission add constraint position_permission_key
  unique nulls not distinct (position_id, module_key, permission, work_item_type_id);

-- A Function Permission on the whole Module: what every Step's check reads, as before RP-1108.
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
            and pp.work_item_type_id is null
        )
      );
    end
  $$;

-- `p_permission` for Type `p_type_id`: on its whole Module, or on that Type alone (RP-1108).
create function app.project_member_has_type_permission(p_project_member_id uuid, p_type_id uuid, p_permission text) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1 from project_member_position mp
          join position_permission pp on pp.position_id = mp.position_id
          join work_item_type t on t.id = p_type_id and t.module_key = pp.module_key
          where mp.project_member_id = p_project_member_id and pp.permission = p_permission
            and (pp.work_item_type_id is null or pp.work_item_type_id = t.id)
        )
      );
    end
  $$;
revoke all on function app.project_member_has_type_permission(uuid, uuid, text) from public;

-- The role a Question asks -------------------------------------------------------------------

alter table work_item_type add column asks_role text check (asks_role in ('consultant', 'contractor', 'owner'));
update work_item_type set asks_role = 'consultant' where owner_kind = 'rabaed' and code = 'QSN';
update work_item_type set asks_role = 'contractor' where owner_kind = 'rabaed' and code = 'QSC';

-- Whether a Participant of base role `p_base_role` would ask its own role with Type `p_type_id`:
-- the Owner Representative acts for the Owner (ADR 0022), so it never asks the Owner either.
create function app.asks_own_role(p_type_id uuid, p_base_role text) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return coalesce((
        select t.asks_role = p_base_role or (t.asks_role = 'owner' and p_base_role = 'owner_representative')
        from work_item_type t where t.id = p_type_id
      ), false);
    end
  $$;
revoke all on function app.asks_own_role(uuid, text) from public;

-- The Question to Owner (QSO) ----------------------------------------------------------------

do $$
  declare
    v_name constant jsonb := '{"en": "Question to Owner", "ar": "سؤال إلى المالك"}';
    v_form uuid;
    v_definition uuid;
    v_type_id uuid;
  begin
    insert into form_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_form;
    insert into workflow_definition (owner_kind, name) values ('rabaed', v_name) returning id into v_definition;
    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id, asks_role)
    values ('rabaed', 'snag_list', 'QSO', v_name, v_definition, 'none', v_form, 'owner')
    returning id into v_type_id;
    update workflow_definition set work_item_type_id = v_type_id where id = v_definition;
  end
$$;

-- The Owner side's Snag List permissions -----------------------------------------------------

insert into position_permission (position_id, module_key, permission, work_item_type_id)
select p.id, 'snag_list', 'create', t.id
from position p
cross join work_item_type t
where p.owner_kind = 'rabaed' and p.base_role in ('owner', 'owner_representative')
  and t.owner_kind = 'rabaed' and t.code in ('QSN', 'QSC', 'QSO')
on conflict do nothing;

insert into position_permission (position_id, module_key, permission)
select p.id, 'snag_list', x.permission
from position p
cross join (values ('submit'), ('close'), ('attach')) x (permission)
where p.owner_kind = 'rabaed' and p.base_role in ('owner', 'owner_representative')
on conflict do nothing;

-- Who holds a Step naming the Owner ----------------------------------------------------------

create or replace function app.next_step_candidates(p_work_item_id uuid, p_transition_id uuid) returns uuid[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
    begin
      select app.actor_role(target.actor_rule, raiser_role.base_role) as base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      -- A Step naming the Owner (its review, ADR 0022; a Question to Owner, RP-1108): an Owner's
      -- Representative covering the item, where the Project has one, else the Owner.
      if v_target.base_role = 'owner' then
        select coalesce(array_agg(p.id), '{}') into v_candidates
        from work_item w
        join participant p on p.project_id = w.project_id and p.status = 'active'
        join project_role r on r.id = p.project_role_id and r.base_role = 'owner_representative'
        where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
      end if;
      if coalesce(cardinality(v_candidates), 0) = 0 then
        select coalesce(array_agg(p.id), '{}') into v_candidates
        from work_item w
        join participant p on p.project_id = w.project_id and p.status = 'active'
        join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
        where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
      end if;
      return v_candidates;
    end
  $$;

-- RP-1108 (decision RP-1004): who may raise a Question. `app.may_raise_type`, rebuilt from
-- RP-1089's 20271113000000_may_raise_type.sql (its newest body): a Draft held by the raiser reads
-- the per-Type `create` too (`app.project_member_has_type_permission`, above),
-- and no Question asks the raiser's own role (`app.asks_own_role`). "New" (`app.raisable_type_ids`),
-- `app.create_work_item` and the Register Import read it, so each answers the same. (Revisions and
-- replacements still read the Module-wide permission; no Question offers either.)

-- Who may raise a Type -------------------------------------------------------------------

create or replace function app.may_raise_type(p_project_member_id uuid, p_type_id uuid, p_workflow_version_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return coalesce((
        select case
          when s.actor_rule ? 'raiser' then app.project_member_has_type_permission(pm.id, t.id, s.actor_rule ->> 'permission')
          else s.actor_rule ->> 'base_role' = r.base_role
        end
          -- A Question never asks the raiser's own role (RP-1108).
          and not app.asks_own_role(t.id, r.base_role)
        from project_member pm
        join participant p on p.id = pm.participant_id
        join project_role r on r.id = p.project_role_id
        join work_item_type t on t.id = p_type_id
        join workflow_step s on s.workflow_version_id = p_workflow_version_id and app.is_draft_step(s.id)
        where pm.id = p_project_member_id
      ), false);
    end
  $$;
