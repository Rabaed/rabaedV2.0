-- Need My Action (RP-346, spec RP-344; GLOSSARY.md Need My Action; visibility.md
-- the Need My Action channel, scenario 70).
--
-- * app.need_my_action(item): why the item is in the acting Member's Need My
--   Action, or null when it isn't:
--   - 'own_draft': a Draft they raised. It stays in view with the toggle on, but
--     nobody is waiting on them, so it is never counted.
--   - 'waiting': an open Step they hold (claimed by them), or a pooled Step of
--     their Step Pool that nobody has claimed (app.step_pool). Once a colleague
--     claims it, it leaves everyone else's.
--   Null for an item the Member doesn't see (it reads past RLS, so it checks
--   app.sees_work_item first), for a closed or cancelled item, and for anything
--   on a closed Project: a closed Project's Need My Action is empty. It answers
--   for one item and names nobody, so it reveals nothing the List doesn't.

create function app.need_my_action(p_work_item_id uuid) returns text
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_me uuid := app.current_member_id();
    begin
      return (
        select case
          when st.category = 'draft' and w.created_by_member_id = v_me then 'own_draft'
          when exists (
            select 1 from step_assignment a
            where a.work_item_id = w.id
              and (
                (a.status = 'claimed' and a.assignee_member_id = v_me)
                or (a.status = 'pooled' and exists (
                  select 1 from app.step_pool(w.id, a.step_id, a.participant_id) p where p.member_id = v_me
                ))
              )
          ) then 'waiting'
        end
        from work_item w
        join project pr on pr.id = w.project_id and pr.status = 'active'
        join work_item_type t on t.id = w.work_item_type_id
        join stage st on st.owner_kind = 'rabaed' and st.module_key = t.module_key and st.key = w.current_stage_key
        where w.id = p_work_item_id and w.closed_at is null and w.discarded_at is null
          and app.sees_work_item(w.id)
      );
    end
  $$;

revoke all on function app.need_my_action(uuid) from public;
grant execute on function app.need_my_action(uuid) to rabaed_app;
