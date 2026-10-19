-- RP-577 (INSP-5, spec RP-649; ADR 0025; form-engine.md §3.3, workflow-engine.md §6;
-- visibility.md V3, V19, scenario RP-577-1): Snags from a WIR's failed check items.
--
-- A check item copied from a Checklist Template with `on_negative: create_snag` (RP-651) shows
-- "Raise a Snag" once the Consultant Engineer answers it Fail or No, ticked by default. The tick is
-- saved with the item's answer in `reply_checklist` (RP-86), `"snag": false` when unticked, so it
-- stays the Consultant's until the code takes it, like the answers (V19).
--
-- When the code is issued, any of A to D, each failed item still ticked becomes a Snag, through
-- the mechanism Code B's rows become Comments (app.transition_follow_up_items, called by
-- app.take_transition once the item is closed):
-- * raised by the acting Consultant Participant; already Raised, at the Step the Snag Draft's
--   single Submit leads to (Open), pooled for the WIR's raiser, never another Contractor (V3);
-- * the WIR's Trade, Location and Scopes; its Subject the item's text in the Project's record
--   language (English when bilingual), at most 200 characters; its description the item's comment;
-- * the item's photos copied as the Snag's "before" photos (the Form's `photos` field), each
--   annotated copy beside its original's copy (RP-656), frozen, as the Snag has left its Draft;
--   the api copies their files in the same transaction (app.raised_document_copies);
-- * a Document Number; `raised_from`-linked to the WIR, the Link naming the check item
--   (`work_item_link.checklist_key`, `item_key`); access for every Participant the WIR has.
-- A Snag Type that can't take them refuses the code and nothing is written, as Code B does.
--
-- To share the route and the item between the Comments and the Snags, the per-item work moves into
-- two helpers, app.follow_up_route and app.raise_follow_up_item; Code B's Comments are raised
-- exactly as before. The route now reads a Draft held by the raiser too (app.actor_role): the
-- Snag's Draft names the raiser, which here is the acting Participant.
--
-- Redefined (from its newest body, `pnpm db:fn`): app.transition_follow_up_items.
-- app.take_transition and app.transition_effects are unchanged (RP-603).

-- The check item a Link names ----------------------------------------------------------------

-- A Snag raised from a failed check item names it: the item's `checklist_template` field (the
-- copy, work_item_checklist.field_key) and the check item's key. Only a `raised_from` Link does.
alter table work_item_link add column checklist_key text, add column item_key text;
alter table work_item_link add constraint work_item_link_check_item check (
  (checklist_key is null) = (item_key is null) and (item_key is null or kind = 'raised_from'));

-- The route a follow-up item takes ------------------------------------------------------------

-- The route an item of Type p_type_id raised from item p_source_id by Participant p_participant_id
-- takes: its Workflow as a new item of that raiser starts (RP-426), its Draft Step, the Draft's
-- single Submit, and the Step it leads to (the item is raised already, at the source's raiser).
-- Refused, raising an error, when the raiser's role doesn't hold the Draft, or the first Step is
-- not of the source raiser's role: a code never drops its follow-up items silently.
create function app.follow_up_route(p_source_id uuid, p_type_id uuid, p_participant_id uuid)
  returns table (workflow_version_id uuid, draft_key text, transition_id uuid, step_id uuid, stage_key text)
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_source record;
      v_version_id uuid;
      v_route record;
    begin
      select w.project_id, t.code as type_code, raiser_role.base_role as raiser_base_role, actor_role.base_role as actor_base_role
      into strict v_source
      from work_item w
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      join participant actor on actor.id = p_participant_id
      join project_role actor_role on actor_role.id = actor.project_role_id
      cross join work_item_type t
      where w.id = p_source_id and t.id = p_type_id;
      v_version_id := app.new_item_workflow_version(v_source.project_id, p_type_id, p_participant_id);
      -- A Step's role on the new item, whose raiser is the acting Participant (app.actor_role).
      select d.key as draft_key, tr.id as transition_id, s.id as step_id, s.stage_key,
        app.actor_role(d.actor_rule, v_source.actor_base_role) as draft_role,
        app.actor_role(s.actor_rule, v_source.actor_base_role) as base_role
      into strict v_route
      from workflow_step d
      join workflow_transition tr on tr.from_step_id = d.id and tr.kind = 'submit'
      join workflow_step s on s.id = tr.to_step_id
      where d.workflow_version_id = v_version_id and app.is_draft_step(d.id);
      if v_route.draft_role is distinct from v_source.actor_base_role then
        raise exception 'a % does not raise % items', v_source.actor_base_role, v_source.type_code;
      end if;
      if v_route.base_role is distinct from v_source.raiser_base_role then
        raise exception '% items do not start with the raiser''s role %', v_source.type_code, v_source.raiser_base_role;
      end if;
      return query select v_version_id, v_route.draft_key, v_route.transition_id, v_route.step_id, v_route.stage_key;
    end
  $$;

revoke all on function app.follow_up_route(uuid, uuid, uuid) from public;

-- The Form keys an item raised on route p_draft_key fills at its Draft: sections with no
-- `editable_at`, or naming the Draft Step, never a section another Participant fills later, such
-- as the Comment's Resolution (WF-8). The Built-in Fields come from the source, never from here.
create function app.follow_up_draft_keys(p_form_version_id uuid, p_draft_key text) returns text[]
  language sql stable
  set search_path = pg_catalog, public
  as $$
    select array(
      select f ->> 'key'
      from form_version v
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where v.id = p_form_version_id and f ->> 'key' not in ('trade', 'location', 'scopes')
        and (s -> 'editable_at' is null or s -> 'editable_at' ? p_draft_key))
  $$;

revoke all on function app.follow_up_draft_keys(uuid, text) from public;

-- One follow-up item -------------------------------------------------------------------------

-- Raises one item of Type p_type_id from item p_source_id, on route p_route (app.follow_up_route),
-- as Code B's Comments always were: raised by p_participant_id (Member p_member_id), already Raised
-- at the route's Step with `submitted_at` set (it has left its raiser, V1), pooled for the
-- source's raiser (routed there, never by §3.1, so never another Contractor; V3); the source's
-- Trade, Location and Scopes; answers p_data and Subject p_subject; a Document Number;
-- `raised_from`-linked to the source (naming check item p_item_key of copy p_checklist_key, when
-- given); access for every Participant the source has, with its reason. Its history starts with
-- the Raise, a `transition` event `shared`, by the raiser. Returns its id.
create function app.raise_follow_up_item(
  p_source_id uuid, p_type_id uuid, p_route record, p_form_version_id uuid, p_participant_id uuid, p_member_id uuid,
  p_subject text, p_data jsonb, p_at timestamptz, p_checklist_key text default null, p_item_key text default null
) returns uuid
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_source record;
      v_id uuid;
      v_number text;
    begin
      select w.project_id, w.raised_by_participant_id into strict v_source from work_item w where w.id = p_source_id;
      insert into work_item (
        project_id, work_item_type_id, raised_by_participant_id, created_by_member_id, title, data, field_times,
        workflow_version_id, form_version_id, current_step_id, current_stage_key, step_entered_at,
        submitted_at, arrivals, created_at, updated_at
      ) values (
        v_source.project_id, p_type_id, p_participant_id, p_member_id,
        p_subject,
        p_data, (select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}') from jsonb_object_keys(p_data) k),
        p_route.workflow_version_id, p_form_version_id, p_route.step_id, p_route.stage_key, p_at,
        -- It has left its raiser: shared from the start, like an item Submitted (V1).
        p_at, 1, p_at, p_at
      ) returning id into v_id;
      -- The source's Trade, Location and Scopes, so the same Members see it (layer 4).
      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select v_id, v.project_id, v.dimension_id, v.dimension_value_id
      from work_item_dimension_value v where v.work_item_id = p_source_id;
      insert into work_item_scope (work_item_id, project_id, scope_id)
      select v_id, s.project_id, s.scope_id from work_item_scope s where s.work_item_id = p_source_id;

      v_number := app.issue_document_number(v_id, p_at);
      update work_item set document_number = v_number, numbered_at = p_at where id = v_id;

      -- Visible exactly where the source is (V2): the raiser, the source's raiser
      -- holding it, and every other Participant the source has, for the same reason.
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      values (v_id, v_source.project_id, p_participant_id, p_at, 'raised'),
        (v_id, v_source.project_id, v_source.raised_by_participant_id, p_at, 'handling');
      insert into work_item_access (work_item_id, project_id, participant_id, since, reason)
      select v_id, a.project_id, a.participant_id, p_at, a.reason
      from work_item_access a where a.work_item_id = p_source_id
      on conflict do nothing;

      -- Held by the source's raiser's Step Pool, from which a Member picks it up.
      insert into step_assignment (project_id, work_item_id, step_id, participant_id, status, created_at, updated_at)
      values (v_source.project_id, v_id, p_route.step_id, v_source.raised_by_participant_id, 'pooled', p_at, p_at);

      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, to_step_id, payload,
        audience, audience_participant_id, created_at
      ) values (
        v_source.project_id, v_id, 'created', p_member_id, p_participant_id, p_route.step_id,
        jsonb_build_object('title', p_subject),
        'internal', p_participant_id, p_at
      );
      -- Raised: its Draft's Submit, taken with the outcome by the same Member, shared.
      insert into work_item_event (
        project_id, work_item_id, type, actor_member_id, actor_participant_id, transition_id,
        from_step_id, to_step_id, payload, audience, content_sha256, created_at
      ) select
        v_source.project_id, v_id, 'transition', p_member_id, p_participant_id, p_route.transition_id,
        tr.from_step_id, p_route.step_id, jsonb_build_object('document_number', v_number), 'shared',
        app.work_item_content_sha256(v_id, w.title, w.data, null), p_at
      from workflow_transition tr, work_item w
      where tr.id = p_route.transition_id and w.id = v_id;

      insert into work_item_link (project_id, from_id, to_id, kind, checklist_key, item_key, created_by_member_id, created_at)
      values (v_source.project_id, v_id, p_source_id, 'raised_from', p_checklist_key, p_item_key, p_member_id, p_at);

      -- Rule 4 (§3.3): a pool of one holds it at once, after the events that raised it.
      perform app.hold_pool_of_one(a.id) from step_assignment a where a.work_item_id = v_id and a.status = 'pooled';
      return v_id;
    end
  $$;

revoke all on function app.raise_follow_up_item(uuid, uuid, record, uuid, uuid, uuid, text, jsonb, timestamptz, text, text) from public;

-- Snags from the failed check items -------------------------------------------------------------

-- The Snags the code of item p_work_item_id raises, Transition p_transition_id taken by
-- Participant p_participant_id (Member p_member_id) at p_at: one from each check item of the reply
-- checklists that Transition took, answered Fail or No, whose copy says `create_snag` and whose
-- "Raise a Snag" tick was not taken off. Nothing without one. A Snag Type that can't take them
-- (none on the Project, its route refused, a photo with no `photos` field to go in) raises an
-- error and nothing is written.
create function app.raise_checklist_snags(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_member_id uuid, p_at timestamptz
) returns void
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_failed record;
      v_type_id uuid;
      v_route record;
      v_form_version_id uuid;
      v_fields text[];
      v_photos_key text;
      v_language text;
      v_comment text;
      v_id uuid;
    begin
      for v_failed in
        -- The checklists that Transition took (its latest event that took any: the Owner's review
        -- writes it twice, and the first took them), each item with its answer, in its order.
        with taken as (
          select r.field_key, r.answers, r.reply_event_id
          from reply_checklist r
          join work_item_event e on e.id = r.reply_event_id
          where r.work_item_id = p_work_item_id and e.transition_id = p_transition_id
            and e.created_at = (
              select max(e2.created_at) from reply_checklist r2 join work_item_event e2 on e2.id = r2.reply_event_id
              where r2.work_item_id = p_work_item_id and e2.transition_id = p_transition_id)
        )
        select k.field_key, k.reply_event_id, c.field_key as checklist_key, i.item, i.n, k.answers -> (i.item ->> 'key') as entry
        from taken k
        join workflow_transition tr on tr.id = p_transition_id
        cross join lateral jsonb_array_elements(tr.action_form -> 'sections') s
        cross join lateral jsonb_array_elements(s -> 'fields') f
        join work_item_checklist c on c.work_item_id = p_work_item_id and c.field_key = f ->> 'copyOf'
        cross join lateral jsonb_array_elements(c.items) with ordinality as i (item, n)
        where f ->> 'key' = k.field_key and f ->> 'type' = 'copied_checklist'
          and i.item ->> 'on_negative' = 'create_snag'
          and k.answers -> (i.item ->> 'key') ->> 'answer' in ('fail', 'no')
          and (k.answers -> (i.item ->> 'key') -> 'snag') is distinct from 'false'::jsonb
        order by k.field_key, i.n
      loop
        if v_type_id is null then
          select t.id into v_type_id from work_item_type t where t.owner_kind = 'rabaed' and t.code = 'SNG';
          if v_type_id is null then
            raise exception 'failed check items raise Snags of a Type that does not exist';
          end if;
          select * into strict v_route from app.follow_up_route(p_work_item_id, v_type_id, p_participant_id);
          v_form_version_id := app.new_item_form_version((select project_id from work_item where id = p_work_item_id), 'SNG');
          v_fields := app.follow_up_draft_keys(v_form_version_id, v_route.draft_key);
          select f ->> 'key' into v_photos_key
          from form_version v
          cross join lateral jsonb_array_elements(v.schema -> 'sections') s
          cross join lateral jsonb_array_elements(s -> 'fields') f
          where v.id = v_form_version_id and f ->> 'type' = 'photos' and f ->> 'key' = any (v_fields)
          limit 1;
          select p.record_language into v_language from project p join work_item w on w.project_id = p.id where w.id = p_work_item_id;
        end if;
        v_comment := nullif(btrim(coalesce(v_failed.entry ->> 'comment', '')), '');
        v_id := app.raise_follow_up_item(
          p_work_item_id, v_type_id, v_route, v_form_version_id, p_participant_id, p_member_id,
          left(btrim(v_failed.item -> 'text' ->> (case v_language when 'ar' then 'ar' else 'en' end)), 200),
          case when v_comment is not null and 'description' = any (v_fields) then jsonb_build_object('description', v_comment) else '{}'::jsonb end,
          p_at, v_failed.checklist_key, v_failed.item ->> 'key');

        -- The item's photos, frozen with the code, copied as the Snag's "before" photos: new
        -- Documents, each named in document_copy (so its fingerprint and an annotated copy's
        -- original follow, by trigger), whose files the api copies (app.raised_document_copies).
        if exists (
          select 1 from document d
          where d.work_item_id = p_work_item_id and d.reply_event_id = v_failed.reply_event_id
            and d.field_key = v_failed.field_key and d.item_key = v_failed.item ->> 'key'
            and d.confirmed_at is not null and d.removed_at is null)
        then
          if v_photos_key is null then
            raise exception 'SNG items take no photos for check item %', v_failed.item ->> 'key';
          end if;
          with source as materialized (
            select gen_random_uuid() as new_id, d.*
            from (
              select d.* from document d
              where d.work_item_id = p_work_item_id and d.reply_event_id = v_failed.reply_event_id
                and d.field_key = v_failed.field_key and d.item_key = v_failed.item ->> 'key'
                and d.confirmed_at is not null and d.removed_at is null
              order by d.confirmed_at, d.id
            ) d
          ), copied as (
            insert into document (
              id, project_id, work_item_id, file_name, size_bytes, content_type, storage_key,
              uploaded_by_member_id, uploaded_by_participant_id, created_at, confirmed_at, frozen_at,
              field_key, taken_at, taken_latitude, taken_longitude
            )
            select s.new_id, s.project_id, v_id, s.file_name, s.size_bytes, s.content_type,
              app.document_storage_key(s.project_id, v_id, s.new_id),
              s.uploaded_by_member_id, s.uploaded_by_participant_id, p_at, p_at, p_at,
              v_photos_key, s.taken_at, s.taken_latitude, s.taken_longitude
            from source s
            returning document.id
          )
          insert into document_copy (document_id, copied_from_id)
          select s.new_id, s.id from source s join copied c on c.id = s.new_id;
        end if;
      end loop;
    end
  $$;

revoke all on function app.raise_checklist_snags(uuid, uuid, uuid, uuid, timestamptz) from public;

-- Follow-up items -------------------------------------------------------------------------------

-- As in the owner_review migration (Code B's rows become items of the Type its outcome's
-- `create_items` names, raised by p_member_id when given, else the acting Member), now through
-- app.follow_up_route and app.raise_follow_up_item, and first the Snags of the failed check items
-- the closing Transition took (app.raise_checklist_snags), at any outcome.
create or replace function app.transition_follow_up_items(
  p_work_item_id uuid, p_transition_id uuid, p_participant_id uuid, p_answers jsonb, p_at timestamp with time zone,
  p_member_id uuid default null
)
 returns void
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
    #variable_conflict use_column
    declare
      v_member_id uuid := coalesce(p_member_id, app.current_member_id());
      v_source record;
      v_type record;
      v_route record;
      v_form_version_id uuid;
      v_fields text[];
      v_subject_key text;
      v_row jsonb;
      v_data jsonb;
    begin
      perform app.raise_checklist_snags(p_work_item_id, p_transition_id, p_participant_id, v_member_id, p_at);
      if jsonb_typeof(p_answers -> 'items_to_create') is distinct from 'array' then
        return;
      end if;
      select w.* into v_source from work_item w where w.id = p_work_item_id;
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

      select * into strict v_route from app.follow_up_route(p_work_item_id, v_type.id, p_participant_id);
      v_form_version_id := app.new_item_form_version(v_source.project_id, v_type.code);
      -- The answers a row gives: its cells of the fields the raiser fills at the Draft.
      v_fields := app.follow_up_draft_keys(v_form_version_id, v_route.draft_key);
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
        perform app.raise_follow_up_item(
          p_work_item_id, v_type.id, v_route, v_form_version_id, p_participant_id, v_member_id,
          left(btrim(coalesce(v_row ->> v_subject_key, '')), 200), v_data, p_at);
      end loop;
    end
  $function$;

-- The files to copy --------------------------------------------------------------------------

-- The files the api copies for the "before" photos this transaction gave the Snags raised from
-- item p_work_item_id (app.raise_checklist_snags): each new Document's key and its source's. Only
-- rows this transaction wrote (their xmin is its id; none of these functions opens a
-- subtransaction), so a replayed Transition, which writes nothing, copies nothing again. Nothing
-- for an item the acting Member doesn't see.
create function app.raised_document_copies(p_work_item_id uuid) returns table (storage_key text, source_storage_key text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select d.storage_key, s.storage_key
        from work_item_link l
        join document d on d.work_item_id = l.from_id
        join document_copy c on c.document_id = d.id
        join document s on s.id = c.copied_from_id and s.work_item_id = p_work_item_id
        where l.to_id = p_work_item_id and l.kind = 'raised_from' and l.item_key is not null
          and d.xmin = xid(pg_current_xact_id())
        order by d.created_at, d.id;
    end
  $$;

revoke all on function app.raised_document_copies(uuid) from public;
grant execute on function app.raised_document_copies(uuid) to rabaed_app;

-- The check item a Snag was raised from -------------------------------------------------------

-- The check item the `raised_from` Link of item p_work_item_id names, as its copy holds it:
-- {key, text}, or null (raised by hand, or from no check item). Static content, like the Link's
-- Document Number and Subject: read for whoever sees the Snag, never the source's live data (E1).
create function app.raised_from_check_item(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if not app.sees_work_item(p_work_item_id) then
        return null;
      end if;
      return (
        select jsonb_build_object('key', i ->> 'key', 'text', i -> 'text')
        from work_item_link l
        join work_item_checklist c on c.work_item_id = l.to_id and c.field_key = l.checklist_key
        cross join lateral jsonb_array_elements(c.items) i
        where l.from_id = p_work_item_id and l.kind = 'raised_from' and i ->> 'key' = l.item_key
        order by l.created_at
        limit 1
      );
    end
  $$;

revoke all on function app.raised_from_check_item(uuid) from public;
grant execute on function app.raised_from_check_item(uuid) to rabaed_app;
