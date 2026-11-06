-- RP-1153: whether a "Step reached" notification came to the Member's Step Pool.
-- The bell and the Notifications page say "Reached your Step Pool at {Step}" rather than "Reached you at
-- {Step}", and, while nobody has picked the Step up yet, "Goes away if a colleague picks it up" (a pick-up
-- withdraws the others' unread ones, app.withdraw_step_reached).
--
-- A Step Pool's assignment is made pooled (picked_up_at null), and a pick-up sets picked_up_at later; one
-- Member alone (the one it came back to, an "Assign to", a pool of one) holds it at once, picked_up_at =
-- created_at (as app.handover_pooled_before reads it). The app role is granted neither column, so no time is
-- read through it: app.notification_pools(notification ids) answers only two booleans, for each of the
-- reader's own "Step reached" notifications among the ids (the notifications policy: their own, in-app,
-- not withdrawn, of an item they still see) whose assignment is their own Participant's:
-- * pool: the assignment was its pool's when it was made;
-- * waiting: it is still in the pool, nobody has picked it up.

create function app.notification_pools(p_notification_ids uuid[])
  returns table (notification_id uuid, pool boolean, waiting boolean)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select n.id, a.picked_up_at is distinct from a.created_at, a.status = 'pooled'
        from notification n
        join step_assignment a on a.id = n.step_assignment_id
        where n.id = any (p_notification_ids)
          and n.kind = 'step_reached'
          and n.member_id = app.current_member_id()
          and n.in_app and n.withdrawn_at is null
          and app.sees_work_item(n.work_item_id)
          and a.participant_id in (select app.current_participant_ids());
    end
  $$;

revoke all on function app.notification_pools(uuid[]) from public;
grant execute on function app.notification_pools(uuid[]) to rabaed_app;
