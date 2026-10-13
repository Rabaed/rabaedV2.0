-- RP-552: the refusal of a caller who is not an Authorized Person came only from
-- app.handover_participants (app.require_authorized_company_id), which the planner
-- evaluates for candidate rows. With no candidate row the call returned [] instead
-- of refusing, so a guard depended on the plan (and RP-108-1..3 flaked).
-- Both functions now check the standing at the top, before any query. Bodies are
-- the newest ones (20270113000000_handover_review.sql), unchanged otherwise.

create or replace function app.handover_pooled_before(p_member_id uuid, p_participant_id uuid)
  returns uuid[]
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  begin
    -- Permission before existence: refused whatever rows there are.
    if p_member_id is not null then
      perform app.require_authorized_company_id();
    end if;
    return array(
      select a.id from step_assignment a
      join project pr on pr.id = a.project_id and pr.status = 'active'
      where a.status = 'pooled'
        and a.participant_id in (select app.handover_participants(p_member_id, p_participant_id))
        and (case when p_member_id is null then exists (select 1 from app.assignment_pool(a.id))
          else p_member_id in (select x.member_id from app.assignment_pool(a.id) x) end)
      order by a.id);
  end
$$;

create or replace function app.handovers_needed(p_member_id uuid, p_participant_id uuid, p_pooled_before uuid[])
  returns table (
    assignment_id uuid, project_id uuid, project_name jsonb, step_name jsonb,
    work_item_id uuid, document_number text, title text,
    holder jsonb, candidates jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
as $$
  #variable_conflict use_column
  begin
    if p_member_id is not null then
      perform app.require_authorized_company_id();
    end if;
    return query
      select a.id, pr.id, pr.name, s.name,
        case when x.sees then w.id end,
        case when x.sees then w.document_number end,
        case when x.sees then w.title end,
        (select jsonb_build_object('id', h.id, 'fullName', h.full_name) from member h where h.id = n.from_member_id),
        coalesce((
          -- A steady order; the dialog orders them in the viewer's language.
          select jsonb_agg(jsonb_build_object('id', m.id, 'fullName', m.full_name) order by m.full_name ->> 'en', m.id)
          from app.assignment_pool(a.id) c
          join member m on m.id = c.member_id
          where c.member_id is distinct from n.from_member_id
        ), '[]'::jsonb)
      from app.handover_assignments(
        p_member_id, array(select app.handover_participants(p_member_id, p_participant_id)), p_pooled_before) n
      join step_assignment a on a.id = n.assignment_id
      join work_item w on w.id = a.work_item_id
      join project pr on pr.id = a.project_id
      join workflow_step s on s.id = a.step_id
      cross join lateral (select app.sees_work_item(w.id) as sees) x
      order by pr.name ->> 'en', pr.id, x.sees desc,
        case when x.sees then w.document_number end nulls last,
        case when x.sees then w.title end,
        a.id;
  end
$$;
