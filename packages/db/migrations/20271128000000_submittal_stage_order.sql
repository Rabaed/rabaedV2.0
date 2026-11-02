-- RP-1219 (owner, 2026-11-02, found in UAT): the Submittals' Stage order becomes Draft, Internal Review,
-- Revise & Resubmit, Pending Approval, Approved, Rejected, Cancelled. It was Draft, Internal Review,
-- Pending Approval, Approved, Revise & Resubmit, Cancelled, Rejected. The Kanban's columns, the List's
-- Stage filter and its counts read the order (stage.sort).
--
-- * The Rabaed Default Stages of the Submittals take the new order, so a Project created from now on
--   copies it (app.copy_rabaed_stages). So do the Inspections': their Stages are the Submittals set
--   (ADR 0025), and a WIR shown inside the Submittals tab sits in the column of its Stage key.
-- * A Project's own copy of either Module changes only while its order is still the old default one, key
--   for key: its Stages are exactly those seven, in that order. A copy its Project Admin reordered, or added
--   a Stage to or removed one from (app.reorder_stages, app.add_stage, app.delete_stage), stays as it is.
--
-- Data only: no function, policy or grant changes. Like RP-622's Snag Stages (20270429000000_snag_type),
-- the change is the platform's, so no setup_event is written for it.

with orders (key, old_sort, new_sort) as (
  values
    ('draft', 1, 1),
    ('internal_review', 2, 2),
    ('pending_approval', 3, 4),
    ('approved', 4, 5),
    ('revise_resubmit', 5, 3),
    ('cancelled', 6, 7),
    ('rejected', 7, 6)
), unchanged_copies as (
  -- Each Project's copy of a Module still in the old default order: the same seven keys, in that order.
  select s.project_id, s.module_key
  from stage s
  where s.owner_kind = 'project' and s.module_key in ('submittals', 'inspections')
  group by s.project_id, s.module_key
  having array_agg(s.key order by s.sort, s.key) = (select array_agg(o.key order by o.old_sort) from orders o)
)
update stage s set sort = o.new_sort, updated_at = now()
from orders o
where s.module_key in ('submittals', 'inspections') and s.key = o.key
  and (s.owner_kind = 'rabaed' or (s.project_id, s.module_key) in (select c.project_id, c.module_key from unchanged_copies c));
