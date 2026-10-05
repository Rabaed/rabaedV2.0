-- Functions in app are executable only by the roles that need them (RP-328;
-- CODING_STANDARDS.md, Database). These five kept the default grant to PUBLIC.
-- The seam-2 grants test now fails on any function in app that PUBLIC may run.

-- RLS policies, column defaults and check constraints run them as the querying
-- role, so both roles that query the tables keep them.
revoke all on function app.current_member_id(), app.uuid_v7(), app.is_bilingual(jsonb) from public;
grant execute on function app.current_member_id(), app.uuid_v7(), app.is_bilingual(jsonb) to rabaed_app, rabaed_admin;

-- Trigger functions: EXECUTE is checked when the trigger is created (by the
-- owner), not when it fires, so no other role needs it.
revoke all on function app.set_option_level(), app.refuse_option_identity_change() from public;
