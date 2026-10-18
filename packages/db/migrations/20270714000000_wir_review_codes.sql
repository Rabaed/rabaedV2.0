-- RP-673 (INSP-10; spec RP-649; ADR 0025; workflow-engine.md §1 "Rabaed Defaults", data-model.md
-- stage and outcome): an Inspection ends with a Review Code, and the Inspections Module takes the
-- Submittals Stages.
--
-- * The WIR Type's outcome kind becomes the Review Code. Its outcome set, the Rabaed Default and
--   every Project's copy, gains Codes A–D with a submittal's follow-ups (app.default_outcomes
--   'review_code': B's rows become Comments, C offers a Revision, the re-inspection, D a
--   replacement), placed first. Passed, Passed with Comments and Failed stay after them: no
--   outcome is ever deleted, and the WIRs on WIR Workflow Version 1 or 2 still close with them
--   (work_item_outcome_in_set). WIR Workflow Version 3, which issues A–D, is a JSON document
--   `pnpm defaults:publish` publishes; Versions 1 and 2 keep their rows, `inspection_result`
--   Steps included.
-- * The Inspections Module's Stages, the Rabaed Defaults and every Project's copy, become the
--   Submittals set: Pending Inspection -> Pending Approval, Passed -> Approved, Failed -> Revise &
--   Resubmit (app.move_stage_key, below), and Rejected (closed negative) is added, copied into
--   every Project as 20270207000000_default_sets_reach_new_projects.sql says a migration does.
--   The Steps of every Workflow Version of the Module and the items in a moved Stage move with
--   it. A name a Project gave a Stage is kept.
-- * The Recommended Code a Step that Recommends a Code may send (app.recommendable_outcomes,
--   redefined from its body in 20270103000000_cancel_recommended_code.sql): a closing outcome of
--   the Type's set that a Transition of the item's own Workflow Version sets, no longer any of the
--   set. A WIR on Version 2 recommends an Inspection Result only, one on Version 3 a Code only.
-- * Visibility: no row is read by anyone new. Stages and outcomes are read as before
--   (member_reads_stages, member_reads_outcomes); the Recommended Code stays internal (V5).

-- Moving a Stage key -------------------------------------------------------------------------

-- Moves Stage key `p_from` of Module `p_module_key` to `p_to`, for Rabaed (a Rabaed Default
-- Stage set changes only by migration or Rabaed Admin): the Rabaed Default Stage and every
-- Project's copy, every Step of a Workflow Version made for a Type of the Module (a published
-- Version too: its rows name the Stage by key) and every item of the Module in it. A Stage still
-- named as the Rabaed Default was takes `p_name`; a name a Project gave it is kept. Where the set
-- already has a `p_to` Stage, the `p_from` one is dropped and its Steps and items join it.
-- The migrator's alone: it lifts the published-Version guard for its own update.
create function app.move_stage_key(p_module_key text, p_from text, p_to text, p_name jsonb) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    declare
      v_default_name jsonb := (select name from stage where owner_kind = 'rabaed' and module_key = p_module_key and key = p_from);
    begin
      delete from stage s
      where s.module_key = p_module_key and s.key = p_from
        and exists (
          select 1 from stage x
          where x.module_key = p_module_key and x.key = p_to and x.project_id is not distinct from s.project_id
        );
      update stage set
        key = p_to,
        name = case when name = v_default_name then p_name else name end,
        updated_at = now()
      where module_key = p_module_key and key = p_from;

      alter table workflow_step disable trigger workflow_step_published_frozen;
      update workflow_step s set stage_key = p_to
      from workflow_version v
      join work_item_type t on t.id = app.workflow_type(v.workflow_definition_id)
      where v.id = s.workflow_version_id and t.module_key = p_module_key and s.stage_key = p_from;
      alter table workflow_step enable trigger workflow_step_published_frozen;

      update work_item w set current_stage_key = p_to
      from work_item_type t
      where t.id = w.work_item_type_id and t.module_key = p_module_key and w.current_stage_key = p_from;
    end
  $$;
revoke all on function app.move_stage_key(text, text, text, jsonb) from public;

-- The Inspections Stages ---------------------------------------------------------------------

select app.move_stage_key('inspections', 'pending_inspection', 'pending_approval', '{"en": "Pending Approval", "ar": "بانتظار الاعتماد"}');
select app.move_stage_key('inspections', 'passed', 'approved', '{"en": "Approved", "ar": "معتمد"}');
select app.move_stage_key('inspections', 'failed', 'revise_resubmit', '{"en": "Revise & Resubmit", "ar": "مراجعة وإعادة تقديم"}');

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'inspections', 'rejected', '{"en": "Rejected", "ar": "مرفوض"}', 'closed_negative', 7);
select app.copy_rabaed_stages(p.id) from project p;

-- The WIR's outcomes ------------------------------------------------------------------------

update work_item_type set outcome_kind = 'review_code', updated_at = now() where owner_kind = 'rabaed' and code = 'WIR';

-- Codes A–D first, in every copy of the set; the Inspection Results keep their order after them.
update outcome o set sort = o.sort + 4, updated_at = now()
from work_item_type t
where t.id = o.work_item_type_id and t.owner_kind = 'rabaed' and t.code = 'WIR';

insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
select 'rabaed', null, t.id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
from work_item_type t
cross join app.default_outcomes('review_code') d
where t.owner_kind = 'rabaed' and t.code = 'WIR'
order by d.sort;
select app.copy_rabaed_outcomes(p.id) from project p;

-- The Recommended Code ------------------------------------------------------------------------

-- The outcomes Transition `p_transition_id` may recommend to Participant `p_participant_id`, the
-- next holder: the closing outcomes of the item's Type's set on its Project that a Transition of
-- the item's Workflow Version sets (RP-673), in the set's order. None unless it is a send from a
-- Step that Recommends a Code to the same Participant.
create or replace function app.recommendable_outcomes(p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid)
  returns table(code text, name jsonb)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_next record;
    begin
      if not exists (
        select 1 from workflow_transition tr join workflow_step s on s.id = tr.from_step_id
        where tr.id = p_transition_id and tr.kind = 'send' and s.outcome_mode = 'recommend_code')
      then
        return;
      end if;
      select * into v_next from app.next_step_holder(p_work_item_id, p_transition_id);
      if v_next.outcome is distinct from 'ok' or v_next.participant_id is distinct from p_participant_id then
        return;
      end if;
      return query
        select o.code, o.name
        from work_item w
        join outcome o on o.project_id = w.project_id and o.work_item_type_id = w.work_item_type_id and o.closing
        where w.id = p_work_item_id
          and exists (select 1 from workflow_transition x where x.workflow_version_id = w.workflow_version_id and x.outcome = o.code)
        order by o.sort, o.code;
    end
  $$;
revoke all on function app.recommendable_outcomes(uuid, uuid, uuid) from public;
