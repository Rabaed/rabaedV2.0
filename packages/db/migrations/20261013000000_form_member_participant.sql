-- The Form's `member` and `participant` fields (RP-266; form-engine.md §2;
-- visibility.md V14, V15).
--
-- * A filler is offered only the Participants they can see: their own, the Host
--   Company's and, on an item, those that appear on it (app.work_item_companies).
--   Never every Participant, not even for a Project Admin: the answer is shown to
--   everyone on the item, who mustn't learn of a Company through it. The Members
--   they are offered (their own Participant's Project Members) need no function:
--   project_member's and member's own RLS already allow only those.
-- * An answer is read through app.work_item_named_answers: a Member of the
--   viewer's own Company by name, anyone else by their Company's name only, and
--   only a Company the viewer may see on that item. Nothing for an item they
--   can't see, and nothing for an id that isn't a `member` or `participant`
--   answer on it, so it can't be asked who an arbitrary id is.

-- The Participants the acting Member may choose in a `participant` field on one
-- of their Projects: their own Company's, the Host Company's, and with
-- p_work_item_id (an item of that Project they see), every Company on the item.
create function app.form_participant_choices(p_project_id uuid, p_work_item_id uuid)
  returns table (participant_id uuid, legal_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select p.id, co.legal_name
    from participant p
    join project pr on pr.id = p.project_id
    join company co on co.id = p.company_id
    where p.project_id = p_project_id and p.status = 'active'
      and p_project_id in (select app.current_project_ids())
      and (
        p.company_id = app.current_company_id()
        or p.company_id = pr.host_company_id
        or p.id in (
          select c.participant_id from work_item w
          cross join lateral app.work_item_companies(w.id) c
          where w.id = p_work_item_id and w.project_id = p_project_id
        )
      )
    order by p.company_id <> app.current_company_id(), p.created_at, p.id
  $$;

-- The `member` and `participant` answers of an item the acting Member sees, by
-- field key, as they may read them: the Company's name when it is their own, the
-- Host Company or on the item; a Member's name only within their own Company.
create function app.work_item_named_answers(p_work_item_id uuid)
  returns table (field_key text, field_type text, company_name jsonb, member_name jsonb)
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    with answer as (
      select f ->> 'key' as field_key, f ->> 'type' as field_type, w.data ->> (f ->> 'key') as value, w.project_id
      from work_item w
      join form_version v on v.id = w.form_version_id
      cross join lateral jsonb_array_elements(v.schema -> 'sections') s
      cross join lateral jsonb_array_elements(s -> 'fields') f
      where w.id = p_work_item_id and app.sees_work_item(p_work_item_id)
        and f ->> 'type' in ('member', 'participant')
        and jsonb_typeof(w.data -> (f ->> 'key')) = 'string'
    ),
    named as (
      -- The Participant each answer names: itself, or the Member's Company's on the Project.
      select a.field_key, a.field_type, a.project_id, p.id as participant_id, p.company_id, m.full_name
      from answer a
      left join member m on a.field_type = 'member' and m.id::text = a.value
      left join participant p on p.project_id = a.project_id and (
        (a.field_type = 'participant' and p.id::text = a.value)
        or (a.field_type = 'member' and p.company_id = m.company_id)
      )
    )
    select n.field_key, n.field_type,
      case when n.company_id = app.current_company_id()
        or n.company_id = (select pr.host_company_id from project pr where pr.id = n.project_id)
        or n.participant_id in (select c.participant_id from app.work_item_companies(p_work_item_id) c)
      then co.legal_name end,
      case when n.field_type = 'member' and n.company_id = app.current_company_id() then n.full_name end
    from named n
    left join company co on co.id = n.company_id
  $$;

revoke all on function
  app.form_participant_choices(uuid, uuid),
  app.work_item_named_answers(uuid)
  from public;
grant execute on function
  app.form_participant_choices(uuid, uuid),
  app.work_item_named_answers(uuid)
  to rabaed_app;
