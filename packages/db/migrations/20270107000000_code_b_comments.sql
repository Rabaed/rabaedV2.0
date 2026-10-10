-- Code B's Comments (RP-434, WF-11; spec RP-423; glossary Comment, Outcome;
-- workflow-engine.md §1 "Outcomes", §5.1, §6; data-model.md; visibility.md scenarios
-- RP-434-1 to RP-434-3).
--
-- * The Snag List's Rabaed Default Stages (Drafts, Open, Resolved, Closed), copied into
--   every Project by stage_rabaed_default_copied, and its Function Permissions for the
--   Rabaed Positions: the Contractor's resolve a Comment ('submit'), the Consultant's
--   raise ('create') and close or return one ('close'); everyone views.
-- * The Comment Work Item Type (CMT, Snag List, outcome kind none: Closed), with its
--   Form (the comment, an optional reference, the Classification, and the resolution
--   note filled by whoever holds Open) and the Rabaed Default Comment Workflow, Version
--   1, published here as data so every environment has it once migrated; the same
--   document is apps/admin/workflows/CMT.json, which `pnpm workflow:publish` publishes
--   as the next Version (seam-1 code-b-comments.test.ts keeps the two equal):
--
--     Draft (Consultant) ─raise→ Open (Contractor) ─resolve→ Resolved (Consultant)
--     Resolved ─close→ Closed · closed       Resolved ─return_to_open→ Open (Send Back)
--
-- * An outcome whose follow-up actions create items (create_items, Code B in the
--   Rabaed Defaults) makes one item of that Type per row of the closing Transition's
--   Action Form table `items_to_create` (app.transition_follow_up_items, called by
--   app.take_transition after its effects, in its transaction). Each item: raised by
--   the acting Participant (the reviewer); on its Type's Workflow as a new item of that
--   raiser starts (app.new_item_workflow_version); already past its Draft, at the Step
--   its Draft's Submit leads to, held by the source's raiser (routed there, not by
--   §3.1: another Contractor of the same role never gets it, V3); with the source's
--   Trade, Location and Scopes; the row's cells as its answers and its first text
--   cell as its Subject; a Document Number; `raised_from`-linked to the source; and
--   visible exactly where the source is: access for every Participant the source has
--   (V2), the Member layer by the same Trade and Location (layer 4).
-- * A Send Back goes back to the Participant that held its target Step before
--   (app.next_step_holder), not to whoever of that role covers the item: a Comment's
--   Return to Open reaches the Contractor that resolved it, never another Contractor
--   (V3). Where the target Step is the raiser's, it is the raiser as before.
-- * app.work_item_comment_counts: the source's Comments open and closed, only those
--   the caller sees (visibility.md, Lists and counts), as the "all Comments closed"
--   rule (RP-430) reads them.

-- The Snag List's Stages and Function Permissions ---------------------------------------

insert into stage (owner_kind, module_key, key, name, category, sort) values
  ('rabaed', 'snag_list', 'draft', '{"en": "Drafts", "ar": "المسودات"}', 'draft', 1),
  ('rabaed', 'snag_list', 'open', '{"en": "Open", "ar": "مفتوحة"}', 'in_progress', 2),
  ('rabaed', 'snag_list', 'resolved', '{"en": "Resolved", "ar": "تمت معالجتها"}', 'in_progress', 3),
  ('rabaed', 'snag_list', 'closed', '{"en": "Closed", "ar": "مغلقة"}', 'closed_positive', 4);

insert into position_permission (position_id, module_key, permission)
select p.id, 'snag_list', x.permission
from (values
  ('contractor', 'engineer', 'view'), ('contractor', 'engineer', 'submit'),
  ('contractor', 'project_manager', 'view'), ('contractor', 'project_manager', 'submit'),
  ('consultant', 'engineer', 'view'), ('consultant', 'engineer', 'create'), ('consultant', 'engineer', 'close'),
  ('consultant', 'manager', 'view'), ('consultant', 'manager', 'create'), ('consultant', 'manager', 'close'),
  ('owner', 'representative', 'view'),
  ('owner_representative', 'engineer', 'view')
) as x (base_role, key, permission)
join position p on p.base_role = x.base_role and p.key = x.key
on conflict do nothing;

-- The Comment Type, its Form and its Workflow --------------------------------------------

do $$
  declare
    v_form uuid;
    v_definition uuid;
    v_version uuid;
    v_type uuid;
  begin
    insert into form_definition (owner_kind, name)
    values ('rabaed', '{"en": "Comment", "ar": "ملاحظة"}')
    returning id into v_form;
    insert into form_version (form_definition_id, version_no, status, published_at, schema)
    values (v_form, 1, 'published', now(), $schema$
      {
        "sections": [
          {
            "key": "comment",
            "title": { "en": "Comment", "ar": "الملاحظة" },
            "fields": [
              { "key": "comment", "type": "textarea", "required": true,
                "label": { "en": "Comment", "ar": "الملاحظة" } },
              { "key": "reference", "type": "text", "required": false,
                "label": { "en": "Reference", "ar": "المرجع" },
                "help": { "en": "The field or Document of the reviewed item this comment is about.",
                          "ar": "الحقل أو المستند في العنصر المراجَع الذي تخصه هذه الملاحظة." } }
            ]
          },
          {
            "key": "classification",
            "title": { "en": "Classification", "ar": "التصنيف" },
            "fields": [
              { "key": "trade", "type": "trade", "required": true,
                "label": { "en": "Trade", "ar": "التخصص" } },
              { "key": "location", "type": "location", "required": true,
                "label": { "en": "Location", "ar": "الموقع" } },
              { "key": "scopes", "type": "scopes", "required": false,
                "label": { "en": "Scopes", "ar": "النطاقات" } }
            ]
          },
          {
            "key": "resolution",
            "title": { "en": "Resolution", "ar": "المعالجة" },
            "editable_at": ["open"],
            "fields": [
              { "key": "resolution_note", "type": "textarea", "required": true,
                "label": { "en": "Resolution note", "ar": "ملاحظة المعالجة" },
                "help": { "en": "Say what was done about the comment.",
                          "ar": "اذكر ما تم بشأن الملاحظة." } }
            ]
          }
        ]
      }
    $schema$::jsonb);

    insert into workflow_definition (owner_kind, name)
    values ('rabaed', '{"en": "Comment", "ar": "ملاحظة"}')
    returning id into v_definition;
    -- Built as a draft, then published: a published Version takes no new parts (RP-424).
    insert into workflow_version (workflow_definition_id, version_no, status)
    values (v_definition, 1, 'draft')
    returning id into v_version;

    insert into workflow_step (workflow_version_id, key, name, stage_key, actor_rule, outcome_mode) values
      (v_version, 'draft', '{"en": "Draft", "ar": "مسودة"}', 'draft',
        '{"base_role": "consultant", "permission": "create"}', 'none'),
      (v_version, 'open', '{"en": "Open", "ar": "مفتوحة"}', 'open',
        '{"base_role": "contractor", "permission": "submit"}', 'none'),
      (v_version, 'resolved', '{"en": "Resolved", "ar": "تمت معالجتها"}', 'resolved',
        '{"base_role": "consultant", "permission": "close"}', 'none'),
      (v_version, 'closed', '{"en": "Closed", "ar": "مغلقة"}', 'closed', '{}', 'none');

    insert into workflow_transition (workflow_version_id, key, from_step_id, to_step_id, label, kind, outcome, permission, sort, action_form)
    select v_version, t.key, f.id, s.id, t.label::jsonb, t.kind, t.outcome, t.permission, t.sort, t.action_form::jsonb
    from (values
      ('raise', 'draft', 'open', '{"en": "Raise", "ar": "إصدار"}', 'submit', null, 'create', 1, null),
      ('resolve', 'open', 'resolved', '{"en": "Resolve", "ar": "تمت المعالجة"}', 'submit', null, 'submit', 2, null),
      ('close', 'resolved', 'closed', '{"en": "Close", "ar": "إغلاق"}', 'close', 'closed', 'close', 3, null),
      ('return_to_open', 'resolved', 'open', '{"en": "Return to Open", "ar": "إعادة فتح"}', 'send_back', null, 'close', 4,
        '{"sections": [{"key": "return", "title": {"en": "Return to Open", "ar": "إعادة فتح"}, "fields": [
          {"key": "reason", "type": "textarea", "required": true, "label": {"en": "Reason", "ar": "السبب"}}]}]}')
    ) as t (key, from_key, to_key, label, kind, outcome, permission, sort, action_form)
    join workflow_step f on f.workflow_version_id = v_version and f.key = t.from_key
    join workflow_step s on s.workflow_version_id = v_version and s.key = t.to_key;

    update workflow_version set status = 'published', published_at = now() where id = v_version;

    insert into work_item_type (owner_kind, module_key, code, name, workflow_definition_id, outcome_kind, form_definition_id)
    values ('rabaed', 'snag_list', 'CMT', '{"en": "Comment", "ar": "ملاحظة"}', v_definition, 'none', v_form)
    returning id into v_type;
    update workflow_definition set work_item_type_id = v_type where id = v_definition;
  end
$$;

-- Items from an outcome's rows ---------------------------------------------------------

-- After the acting Member (of Participant `p_participant_id`) took Transition
-- `p_transition_id`, closing item `p_work_item_id` with Action Form answers
-- `p_answers`: when its outcome's follow-up actions create items of a Type, one such
-- item per row of the answers' `items_to_create` table (WF-11; workflow-engine.md §6).
-- Nothing for any other outcome, or no rows. A Type or Workflow that can't take them
-- (no Type of that code, no single Submit out of its Draft, a Draft the acting
-- Participant's role doesn't hold, or a first Step not of the source raiser's role)
-- raises: publishing never lets a Rabaed Default get there, and a Code B that
-- silently dropped its Comments would be worse than one refused.
create function app.transition_follow_up_items(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_answers jsonb, p_at timestamptz
) returns void
  language plpgsql volatile
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member_id uuid := app.current_member_id();
      v_source record;
      v_type record;
      v_version_id uuid;
      v_start record;
      v_form_version_id uuid;
      v_fields text[];
      v_subject_key text;
      v_row jsonb;
      v_data jsonb;
      v_id uuid;
      v_number text;
    begin
      if jsonb_typeof(p_answers -> 'items_to_create') is distinct from 'array' then
        return;
      end if;
      select w.*, raiser_role.base_role as raiser_base_role, actor_role.base_role as actor_base_role
      into v_source
      from work_item w
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      join participant actor on actor.id = p_participant_id
      join project_role actor_role on actor_role.id = actor.project_role_id
      where w.id = p_work_item_id;
      -- The Type its outcome's rows become, in the Type's set on the item's Project (RP-429).
      select t.id, t.code into v_type
      from outcome o
      cross join lateral jsonb_array_elements(o.actions) a
      join work_item_type t on t.owner_kind = 'rabaed' and t.code = a ->> 'type'
      where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
        and o.code = v_source.outcome and a ->> 'kind' = 'create_items';
      if v_type.id is null then
        if exists (
          select 1 from outcome o
          where o.project_id = v_source.project_id and o.work_item_type_id = v_source.work_item_type_id
            and o.code = v_source.outcome and o.actions @> '[{"kind": "create_items"}]')
        then
          raise exception 'outcome % creates items of a Type that does not exist', v_source.outcome;
        end if;
        return;
      end if;

      -- Its Workflow as a new item of that raiser starts (RP-426), and the Step its
      -- Draft's Submit leads to: the item is raised already, at the source's raiser.
      v_version_id := app.new_item_workflow_version(v_source.project_id, v_type.id, p_participant_id);
      select s.id, s.stage_key, s.actor_rule ->> 'base_role' as base_role, d.actor_rule ->> 'base_role' as draft_role,
        tr.id as transition_id
      into strict v_start
      from workflow_step d
      join workflow_transition tr on tr.from_step_id = d.id and tr.kind = 'submit'
      join workflow_step s on s.id = tr.to_step_id
      where d.workflow_version_id = v_version_id and app.is_draft_step(d.id);
      if v_start.draft_role is distinct from v_source.actor_base_role then
        raise exception 'a % does not raise % items', v_source.actor_base_role, v_type.code;
      end if;
      if v_start.base_role is distinct from v_source.raiser_base_role then
        raise exception '% items do not start with the raiser''s role %', v_type.code, v_source.raiser_base_role;
      end if;

      v_form_version_id := app.latest_form_version(v_type.code);
      -- The answers a row gives: its cells of the fields the Type's Form has (the
      -- Built-in Fields come from the source, never from a row).
      v_fields := array(
        select f ->> 'key'
        from form_version v
        cross join lateral jsonb_array_elements(v.schema -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        where v.id = v_form_version_id and f ->> 'key' not in ('trade', 'location', 'scopes'));
      -- Each row's Subject: its first text cell (publishing asks the table for one).
      select c ->> 'key' into v_subject_key
      from workflow_transition tr
      cross join lateral jsonb_array_elements(tr.action_form -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      cross join lateral jsonb_array_elements(f -> 'columns') with ordinality as c (c, n)
      where tr.id = p_transition_id and f ->> 'key' = 'items_to_create' and c ->> 'type' = 'text'
      order by n limit 1;

      for v_row in select r from jsonb_array_elements(p_answers -> 'items_to_create') r loop
        select coalesce(jsonb_object_agg(k, v), '{}') into v_data
        from jsonb_each(v_row) as cell (k, v) where k = any (v_fields);
        insert into work_item (
          project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
          workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
          submitted_at, arrivals, created_at, updated_at
        ) values (
          v_source.project_id, v_type.id, p_participant_id, v_member_id,
          left(btrim(coalesce(v_row ->> v_subject_key, '')), 200),
          v_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(v_data) k),
          v_version_id, v_form_version_id, v_start.id, v_start.stage_key, p_at,
          -- It has left its raiser: shared from the start, like an item Submitted (V1).
          p_at, 1, p_at, p_at
        ) returning id into v_id;
        -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
        insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
        select v_id, v.project_id, v.dimension_id, v.dimension_value_id
        from work_item_dimension_value v where v.work_item_id = p_work_item_id;
        insert into work_item_scope (work_item_id, project_id, scope_id)
        select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_work_item_id;

        v_number := app.issue_document_number(v_id, p_at);
        update work_item set document_number = v_number, numbered_at = p_at where id = v_id;

        -- Visible exactly where the source is (V2): the raiser, the source's raiser
        -- holding it, and every other Participant the source has, for the same reason.
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
          (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
        insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
        select v_id, a.project_id, a.participant_id, p_at, a.reason
        from work_item_access a where a.work_item_id = p_work_item_id
        on conflict do nothing;

        -- Held by the source's raiser's Step Pool, which claims it.
        insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
        values (v_source.project_id, v_id, v_start.id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
          audience, audience_participant_id, created_at
        ) values (
          v_source.project_id, v_id, 'created', v_member_id, p_participant_id, v_start.id,
          jsonb_build_object('title', left(btrim(coalesce(v_row ->> v_subject_key, '')), 200)),
          'internal', p_participant_id, p_at
        );
        -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
        insert into work_item_event (
          project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
          from_step_id, to_step_id, payload, audience, content_sha256, created_at
        ) select
          v_source.project_id, v_id, 'transition', v_member_id, p_participant_id, v_start.transition_id,
          tr.from_step_id, v_start.id, jsonb_build_object('document_number', v_number), 'shared',
          app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
        from workflow_transition tr, work_item w
        where tr.id = v_start.transition_id and w.id = v_id;

        insert into work_item_link (project_id, from_id, to_id, kind, created_by_member_id, created_at)
        values (v_source.project_id, v_id, p_work_item_id, 'raised_from', v_member_id, p_at);
      end loop;
    end
  $$;
revoke all on function app.transition_follow_up_items(uuid, uuid, uuid, jsonb, timestamptz) from public;

-- A Send Back goes back to its target Step's last holder ---------------------------------

-- As in 20270106100000_not_same_person_pool.sql, with a Send Back to a Step a Participant
-- other than the raiser held before going back to that Participant (V3).
create or replace function app.next_step_holder(p_work_item_id uuid, p_transition_id uuid)
  returns table (outcome text, participant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_target record;
      v_candidates uuid[];
      v_previous uuid;
      v_actor uuid := (select me.participant_id from app.acting_project_member(p_work_item_id) me);
    begin
      select tr.to_step_id as step_id, tr.kind, target.actor_rule ->> 'base_role' as base_role,
        w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_base_role
      into v_target
      from work_item w
      join workflow_transition tr on tr.id = p_transition_id and tr.workflow_version_id = w.workflow_version_id
      join workflow_step target on target.id = tr.to_step_id
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      where w.id = p_work_item_id;
      if v_target.base_role is null then
        return query select 'terminal'::text, null::uuid;
        return;
      end if;

      if v_target.base_role = v_target.raiser_base_role then
        -- The raiser's own Steps stay with the raiser, never another Participant of its role (V3).
        if exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_target.raiser_id, v_actor)) then
          return query select 'ok'::text, v_target.raiser_id;
        else
          return query select 'no_step_pool'::text, null::uuid;
        end if;
        return;
      end if;

      -- A Send Back goes back to the Participant that held that Step (it Submitted the
      -- item from there), never to another of its role (V3): a Comment Returned to Open
      -- reaches the Contractor that resolved it.
      if v_target.kind = 'send_back' then
        select a.participant_id into v_previous from step_assignment a
        where a.work_item_id = p_work_item_id and a.step_id = v_target.step_id and a.status = 'done'
        order by a.done_at desc, a.id desc limit 1;
      end if;
      if v_previous is not null then
        v_candidates := array[v_previous];
      else
        select coalesce(array_agg(p.id), '{}') into v_candidates
        from work_item w
        join participant p on p.project_id = w.project_id and p.status = 'active'
        join project_role r on r.id = p.project_role_id and r.base_role = v_target.base_role
        where w.id = p_work_item_id and app.participant_covers_item(p.id, w.id);
      end if;
      if cardinality(v_candidates) = 1
        and exists (select 1 from app.transition_step_pool(p_work_item_id, p_transition_id, v_candidates[1], v_actor))
      then
        return query select 'ok'::text, v_candidates[1];
      else
        return query select 'next_step_unavailable'::text, null::uuid;
      end if;
    end
  $$;

-- Taking a Transition ---------------------------------------------------------------------

-- As in 20270106600000_cancel_not_for_revisions.sql, with the outcome's follow-up items
-- made after its effects (WF-11).
create or replace function app.take_transition(
  p_work_item_id uuid, p_transition_key text, p_answers jsonb, p_internal_note text, p_checked_data_sha256 bytea,
  p_idempotency_key uuid, p_now timestamptz, p_assign_to uuid default null, p_recommended_code text default null
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
      v_actions record;
      v_next record;
    begin
      -- Nobody locks an item they can't see.
      if not app.sees_work_item(p_work_item_id) then
        return 'not_found';
      end if;
      -- One Member's key is taken by one command at a time, whichever item it names.
      perform pg_advisory_xact_lock(hashtextextended(v_member_id::text || '/' || p_idempotency_key::text, 0));
      select w.*, t.module_key, pr.status as project_status
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

      select tr.* into v_transition
      from workflow_transition tr
      where tr.workflow_version_id = v_item.workflow_version_id and tr.from_step_id = v_item.current_step_id
        and tr.key = p_transition_key;
      -- A Cancel after the first Submit, or of a Revision, isn't there either (RP-433).
      if v_transition.id is null or not app.cancel_allowed(v_transition.kind, v_item.submitted_at, v_item.revision_no) then
        return 'transition_not_available';
      end if;
      -- Its rules (WF-7): the route among Transitions sharing its label, Restrict, Validate.
      select * into v_rules from app.transition_rules(p_work_item_id, v_transition.id, p_answers);
      if v_rules.refusal is not null then
        return v_rules.refusal;
      end if;
      if v_rules.transition_id <> v_transition.id then
        select tr.* into v_transition from workflow_transition tr where tr.id = v_rules.transition_id;
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
      -- The next holder (§3), with the "Assign to" pick (WF-8).
      select * into v_next from app.transition_next_holder(p_work_item_id, v_transition.id, v_me.participant_id, p_assign_to);
      if v_next.outcome not in ('ok', 'terminal') then
        return v_next.outcome;
      end if;
      -- The Recommended Code (RP-433, §5.3): only one the Transition offers, so only
      -- from a Step that Recommends a Code, to the next reviewer of the same
      -- Participant, and a closing outcome of the Type's set; refused alike otherwise,
      -- before the actions step writes anything.
      if p_recommended_code is not null and not exists (
        select 1 from app.recommendable_outcomes(p_work_item_id, v_transition.id, v_me.participant_id) o
        where o.code = p_recommended_code)
      then
        return 'recommended_code_not_offered';
      end if;
      -- Its actions (WF-8): set and copy, into what the acting Participant fills at
      -- this Step only; refused as a whole, or written (and recorded) before any effect.
      select * into v_actions from app.transition_actions(p_work_item_id, v_transition.id, p_answers, v_at);
      if v_actions.refusal is not null then
        return v_actions.refusal;
      end if;

      perform app.transition_effects(
        p_work_item_id, v_transition.id, v_me.participant_id, v_assignment.id,
        v_next.outcome, v_next.participant_id, v_next.holder_member_id,
        v_actions.answers, nullif(btrim(p_internal_note), ''), p_recommended_code, v_at);
      -- Its outcome's follow-up items (WF-11: Code B's Comments), once it is closed.
      if v_next.outcome = 'terminal' then
        perform app.transition_follow_up_items(p_work_item_id, v_transition.id, v_me.participant_id, v_actions.answers, v_at);
      end if;

      insert into command_idempotency (member_id, key, project_id, work_item_id, command, created_at)
      values (v_member_id, p_idempotency_key, v_item.project_id, p_work_item_id, 'transition:' || p_transition_key, v_at);
      return 'applied';
    end
  $$;

-- The source's Comments ------------------------------------------------------------------

-- How many of the items raised from item `p_work_item_id` (its Comments, `raised_from`)
-- are open and closed, of those the caller sees, never a discarded one: the same items
-- the "all Comments closed" rule reads (RP-430). No row for an item the caller doesn't see.
create function app.work_item_comment_counts(p_work_item_id uuid) returns table (open_count integer, closed_count integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select (count(*) filter (where c.closed_at is null))::integer, (count(*) filter (where c.closed_at is not null))::integer
        from work_item_link l
        join work_item c on c.id = l.from_id
        where l.to_id = p_work_item_id and l.kind = 'raised_from' and l.removed_at is null
          and c.discarded_at is null and app.sees_work_item(c.id);
    end
  $$;
revoke all on function app.work_item_comment_counts(uuid) from public;
grant execute on function app.work_item_comment_counts(uuid) to rabaed_app;
