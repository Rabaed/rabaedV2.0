-- RP-959 (spec RP-631, story 34; visibility.md RP-589-3): a Rabaed Engineer's import keeps its
-- original register, as a Member's does (RP-644), for the importing Participant's Members to
-- download. Rabaed Admin has no file store and no way to the api (ADR 0010), so it hands the file
-- over here, in its preview's own transaction, and the api, which alone writes files, stores it
-- under the import's key (app.register_import_file_key) at the first download by a Member who
-- reads the import.
--
-- * The hand-over takes the file of the Engineer's own `previewed` import that keeps none yet, once,
--   and names it at once (`source_file_id`), so the import reads as keeping an original.
-- * Nobody reads the table but the two functions below, and it keeps no time (owner, RP-631).
-- * A preview the worker cleans up takes its hand-over with it (on delete cascade); its key still
--   goes to register_import_file_removal, and deleting a file never stored deletes nothing.

create table register_import_original_hand_over (
  import_id uuid primary key references submittal_register_import (id) on delete cascade,
  bytes bytea not null check (octet_length(bytes) > 0)
);
revoke all on register_import_original_hand_over from rabaed_app;
revoke all on register_import_original_hand_over from rabaed_admin;

-- Rabaed Admin hands over the original register of the Engineer's own preview p_import_id.
-- Outcome 'handed_over', or 'not_found' (not their preview, confirmed, or one that keeps a file already).
create function app.hand_over_register_import_original_by_engineer(p_engineer_id uuid, p_import_id uuid, p_bytes bytea) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_import_id uuid;
    begin
      update submittal_register_import i set source_file_id = gen_random_uuid()
      where i.id = p_import_id and i.run_by_engineer_id = p_engineer_id and i.status = 'previewed' and i.source_file_id is null
      returning i.id into v_import_id;
      if v_import_id is null then
        return 'not_found';
      end if;
      insert into register_import_original_hand_over (import_id, bytes) values (v_import_id, p_bytes);
      return 'handed_over';
    end
  $$;

-- The original handed over for the import p_import_id, taken off the hand-over for the api to store
-- under the import's key; null when there is none, or the acting Member doesn't read the import (an
-- Engineer's import is read once confirmed, by the importing Participant's Members).
create function app.take_register_import_original_hand_over(p_import_id uuid) returns bytea
  language sql volatile security definer
  set search_path = pg_catalog, public
  as $$
    delete from register_import_original_hand_over h
    using submittal_register_import i
    where h.import_id = p_import_id and i.id = h.import_id and i.status = 'created'
      and i.participant_id in (select app.current_participant_ids())
      and i.project_id in (select app.current_project_ids())
    returning h.bytes
  $$;

revoke all on function
  app.hand_over_register_import_original_by_engineer(uuid, uuid, bytea),
  app.take_register_import_original_hand_over(uuid)
  from public;
grant execute on function app.hand_over_register_import_original_by_engineer(uuid, uuid, bytea) to rabaed_admin;
grant execute on function app.take_register_import_original_hand_over(uuid) to rabaed_app;
