-- Drops a stale app.take_transition overload (found by RP-328's grant check).
--
-- 20261026000000_action_forms.sql replaced take_transition's `p_reason text`
-- with `p_answers jsonb` and dropped the old signature. RP-312's
-- 20261026100000_numbering_pattern.sql was written before that and still used
-- the old signature, so on a fresh database it created the old
-- (uuid, text, text, text, bytea, uuid, timestamptz) overload again, beside the
-- current one. Nothing calls it (the api passes the answers), but it is a
-- security definer function that kept the default grant to public, with the
-- numbering body of RP-312 and none of RP-299's section rules.
--
-- The current take_transition (20261105000000_create_revision.sql) is untouched.

drop function if exists app.take_transition(uuid, text, text, text, bytea, uuid, timestamptz);
