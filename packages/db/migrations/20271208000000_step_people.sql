-- RP-1189: the people on the viewer's own Steps, for the Submittal Panel's Workflow modal (gap table v3 row 21).
--
-- For each Step of item p_work_item_id's pinned Version that the caller's own Participant works,
-- the names of its Step Pool (app.step_pool, for that Participant): who of their own Company can
-- act there. Another Company's Steps give nothing, neither a name nor an id (visibility.md V14,
-- V15), and so does an item the caller doesn't see.
--
-- Which Participant works a Step: one the caller's own Participant has held on this item is theirs
-- (an Owner Representative holding the Owner's review); otherwise as app.next_step_holder would
-- send it: a Step of the raiser's role (or one held by the raiser, RP-622) is the raiser's, never
-- another Participant of its role (V3); any other Step is the caller's when it is of their role,
-- they cover the item, and no other Participant has held it. Terminal Steps have no people.

create function app.work_item_step_people(p_work_item_id uuid)
  returns table (step_key text, names jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_item record;
    begin
      select w.id, w.workflow_version_id, w.raised_by_participant_id as raiser_id, raiser_role.base_role as raiser_role,
        me.id as participant_id, my_role.base_role as my_role
      into v_item
      from work_item w
      join participant raiser on raiser.id = w.raised_by_participant_id
      join project_role raiser_role on raiser_role.id = raiser.project_role_id
      -- One row at most: a Member is of one Company, and a Company has one Participant per Project (participant_project_company_key).
      join participant me on me.project_id = w.project_id and me.status = 'active' and me.id in (select app.current_participant_ids())
      join project_role my_role on my_role.id = me.project_role_id
      where w.id = p_work_item_id and app.sees_work_item(w.id);
      if v_item.id is null then
        return;
      end if;
      return query
        select s.key, coalesce(jsonb_agg(m.full_name order by m.full_name ->> 'en', m.id) filter (where m.id is not null), '[]'::jsonb)
        from workflow_step s
        cross join lateral (select app.actor_role(s.actor_rule, v_item.raiser_role) as role) r
        left join app.step_pool(v_item.id, s.id, v_item.participant_id) p on true
        left join member m on m.id = p.member_id
        where s.workflow_version_id = v_item.workflow_version_id
          and r.role is not null
          and case
            -- A Step their own Participant has held on this item is theirs, whatever its role: an Owner
            -- Representative holding the Owner's review (ADR 0022), say.
            when exists (
              select 1 from step_assignment a
              where a.work_item_id = v_item.id and a.step_id = s.id and a.participant_id = v_item.participant_id) then true
            when r.role = v_item.raiser_role then v_item.participant_id = v_item.raiser_id
            else r.role = v_item.my_role
              and app.participant_covers_item(v_item.participant_id, v_item.id)
              and not exists (
                select 1 from step_assignment a
                where a.work_item_id = v_item.id and a.step_id = s.id and a.participant_id <> v_item.participant_id)
          end
        group by s.key;
    end
  $$;

revoke all on function app.work_item_step_people(uuid) from public;
grant execute on function app.work_item_step_people(uuid) to rabaed_app;
