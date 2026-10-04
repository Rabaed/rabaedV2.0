-- Link search (RP-290, spec RP-289; form-engine.md part 2b; visibility.md
-- "Link search" row and scenario 29).
--
-- * app.work_item_submitted: whether a Work Item the acting Member sees has been
--   Submitted, that is, it has left its raiser at least once: the Step at which
--   its current holder's Participant received it (participant_entered_step_id)
--   is no longer the Draft Step it started at. A Draft and an item in its
--   raiser's internal review are not; an item closed after Submit is. An item
--   the Member can't see answers false, like one that doesn't exist.
--   participant_entered_step_id isn't granted to the app role, hence a function.
--   Link search offers only Submitted items, and Links (RP-291) accept only them.

create function app.work_item_submitted(p_work_item_id uuid) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public
  as $$
    select app.sees_work_item(p_work_item_id) and exists (
      select 1 from work_item w
      where w.id = p_work_item_id and not app.is_draft_step(w.participant_entered_step_id)
    )
  $$;

revoke all on function app.work_item_submitted(uuid) from public;
grant execute on function app.work_item_submitted(uuid) to rabaed_app;
