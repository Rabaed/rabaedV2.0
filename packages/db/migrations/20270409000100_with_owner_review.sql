-- Review fixes for spec RP-598: "With Owner review" (ADR 0022, V14; workflow-engine.md §5.3a).
-- While an item waits at a confirming Step (`confirm_code`), a reader who is neither of the
-- Participant holding the review nor of the Consultant that recommended the Code reads its
-- "With" as the label "Owner review" («مراجعة المالك»), never the holding Company's name:
-- the Contractor, and the Owner while an Owner Representative holds the review.
--
-- app.with_owner_review gives that label, or null when the reader reads the holder as before
-- (the item is elsewhere, or the reader is one of the two). The work item query, the item, its
-- Workflow map and the weekly Step Age report read it in place of the holder's name.

create function app.with_owner_review(p_work_item_id uuid) returns jsonb
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if exists (
        select 1
        from work_item w
        join workflow_step s on s.id = w.current_step_id and s.outcome_mode = 'confirm_code'
        where w.id = p_work_item_id and w.closed_at is null and app.sees_work_item(w.id)
          -- Not the Participant holding the review.
          and not exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id and a.status in ('pooled', 'picked_up', 'vacant')
              and a.participant_id in (select app.current_participant_ids()))
          -- Nor the Consultant whose Recommendation brought it there (app.recommendation_to_confirm,
          -- read here past row-level security: that Submit is internal to the two).
          and not exists (
            select 1 from (
              select e.actor_participant_id from work_item_event e
              where e.work_item_id = w.id and e.type = 'transition' and e.to_step_id = w.current_step_id
              order by e.seq desc limit 1
            ) last
            where last.actor_participant_id in (select app.current_participant_ids()))
      ) then
        return '{"en": "Owner review", "ar": "مراجعة المالك"}'::jsonb;
      end if;
      return null;
    end
  $$;

revoke all on function app.with_owner_review(uuid) from public;
grant execute on function app.with_owner_review(uuid) to rabaed_app;

-- The weekly Step Age report (20261229000000_project_stages.sql), as before but for the holder's
-- name, which is "Owner review" to whoever app.with_owner_review gives it.
create or replace function app.take_step_age_report(p_outbox_id uuid)
  returns table (
    to_address text, language text, project_id uuid, project_name jsonb, open_stage_keys text[],
    work_item_id uuid, document_number text, subject text, stage_name jsonb,
    held_by_own boolean, step_name jsonb, holder_name jsonb, entered_at timestamptz
  )
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_saved text := current_setting('app.member_id', true);
      v_project uuid;
      v_member uuid;
    begin
      perform app.require_worker();
      select o.project_id, (o.payload ->> 'member_id')::uuid into v_project, v_member
      from outbox o where o.id = p_outbox_id and o.kind = 'step_age_report' and o.processed_at is null;
      if v_member is null then
        return;
      end if;
      -- A closed Project goes quiet.
      if not exists (select 1 from project p where p.id = v_project and p.status = 'active') then
        return;
      end if;
      -- Still on the Project, holding Assign.
      if not exists (
        select 1 from project_member pm
        join member m on m.id = pm.member_id and m.status = 'active'
        where pm.project_id = v_project and pm.member_id = v_member and pm.status = 'active'
          and app.project_member_holds_assign(pm.id)
      ) then
        return;
      end if;
      -- Their settings now: the group's email off, email paused, the Project muted.
      -- "Immediately" and "daily digest" both send it: the report has its own time.
      if coalesce((select r.email from app.member_notification_route(v_member, v_project, 'weekly_report', null) r), 'none') = 'none' then
        return;
      end if;

      -- As the recipient: exactly the visibility every read of theirs applies.
      perform set_config('app.member_id', v_member::text, true);
      return query
        select m.email, coalesce(pref.preferred_language, m.locale), pr.id, pr.name,
          array(
            select s.key from stage s
            where s.module_key = 'submittals' and s.project_id = v_project and s.category in ('draft', 'in_progress')
            order by s.sort, s.key
          ),
          i.id, i.document_number, i.title, i.stage_name, i.held_by_own, i.step_name, i.holder_name, i.entered_at
        from member m
        left join member_notification_preference pref on pref.member_id = m.id
        join project pr on pr.id = v_project
        cross join lateral (
          select w.id, w.document_number, w.title, st.name as stage_name,
            coalesce(h.participant_id in (select app.current_participant_ids()), false) as held_by_own,
            s.name as step_name, coalesce(app.with_owner_review(w.id), hc.legal_name) as holder_name, seen.entered_at
          from work_item w
          cross join lateral app.step_as_seen(w.id) seen
          join workflow_step s on s.id = seen.step_id
          join work_item_type t on t.id = w.work_item_type_id
          join stage st on st.project_id = w.project_id and st.module_key = t.module_key and st.key = seen.stage_key
          left join lateral (select * from app.work_item_holder(w.id) limit 1) h on true
          left join lateral (
            select c.legal_name from app.work_item_companies(w.id) c where c.participant_id = h.participant_id
          ) hc on true
          where w.project_id = v_project and t.module_key = 'submittals'
            and st.category in ('draft', 'in_progress')
            -- An un-numbered Draft has no Step Age (scenario 76).
            and w.document_number is not null
            and app.latest_visible_revision(w.id)
        ) i
        where m.id = v_member
        order by i.entered_at, i.id;
      perform set_config('app.member_id', coalesce(v_saved, ''), true);
    end
  $$;
