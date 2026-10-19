-- RP-646: Bulk Transitions (spec RP-616 stories 39–45; data-model.md command_idempotency).
--
-- * A bulk Transition is a command of the api over the existing engine: one Transition on
--   several items, each through app.take_transition with a key of its own made from the
--   request's, in one transaction, all or nothing. Nothing here changes app.take_transition or
--   its helpers.
-- * app.command_keys_used: how many of `p_keys` the calling Member has already applied a command
--   under. command_idempotency has no read policy, so this is how the api tells a repeated bulk
--   request (all of its items' keys used: answer the same items) from a new one (none used) and
--   from a key reused for other items (some used). It reads only the caller's own keys, and
--   answers a count, never which item or command a key was used for.

create function app.command_keys_used(p_keys uuid[]) returns integer
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return (
        select count(*)::integer from command_idempotency c
        where c.member_id = app.current_member_id() and c.key = any (p_keys)
      );
    end
  $$;

revoke all on function app.command_keys_used(uuid[]) from public;
grant execute on function app.command_keys_used(uuid[]) to rabaed_app;
