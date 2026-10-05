-- RP-319: five functions were never revoked from PUBLIC, so every role could run
-- them. None is security definer, but a function's grants should be a decision.
-- A seam-2 test now fails for any function PUBLIC may execute.

revoke all on function
  app.current_member_id(),
  app.uuid_v7(),
  app.is_bilingual(jsonb),
  app.set_option_level(),
  app.refuse_option_identity_change()
from public;

-- The helpers run in policies, column defaults and checks for both roles.
grant execute on function
  app.current_member_id(),
  app.uuid_v7(),
  app.is_bilingual(jsonb)
to rabaed_app, rabaed_admin;

-- The two trigger functions need no grant: a trigger fires without the
-- inserting role holding EXECUTE on its function.
