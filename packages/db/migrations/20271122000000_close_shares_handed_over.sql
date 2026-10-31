-- RP-955 (ADR 0027; visibility.md V19 and the File downloads, Links and Linked from channels; scenarios
-- RP-955-1 and RP-955-2): a close shares only what was handed over.
--
-- Before, app.item_row_as_arrived gave everyone who sees a closed item all of its Documents and Links, so
-- a Document or Link its holder added after the item's last arrival with the others (its raiser after a
-- Send Back, V19) reached them at the close. A Member's Cancel isn't offered once an item was Submitted
-- (RP-433, app.cancel_allowed), so today that close is Rabaed's own cancel when a Company leaves the
-- Project (RP-952, not built yet); the rule holds for any close. The sealed Documental Record already
-- leaves such files out (RP-147, app.documents_shared_before_close), so the live item and the Record
-- disagreed. Now they read one rule:
--
-- * After the close, the other Participants read the rows the item had at its last arrival with them:
--   every row but those added during the arrival the close follows, `arrival <> arrivals - 1` (the close
--   counts one arrival itself, app.share_answers_on_leaving), so those added before it, as the Record,
--   and those Rabaed adds after the close (a Revision's chain Links to its closed original, stamped with
--   the close's own arrival), as before. A Link removed during that arrival is gone for everyone, as
--   before (app.drop_removed_links_on_leaving; RP-1149 to decide otherwise).
-- * The Participant that held the item at the close keeps reading what it added, as while it held it:
--   app.held_at_close, a Step of one of the acting Member's Participants done at the close. Every close
--   writes it so: app.take_transition's effects mark the Step it closes from done, and the cancel of
--   20270110000000_pick_up_rename.sql every open Step, at the moment they set `closed_at`. A close that
--   left a Step open still finds its holder through app.holds_work_item. RP-952's cancel must mark the
--   Steps done at its `closed_at` too.
-- * A reply file a shared event took (ADR 0024) was handed over with that event, whatever its arrival: a
--   Code's own files, taken by the Transition that closes the item, as the Record prints them (its
--   `or d.reply_event_id is not null`). The Documents readers below share one rule for it,
--   app.document_seen: the arrival rule, or such a reply file, and app.reply_event_seen, which still keeps
--   one only an internal event took inside the Participants it reaches (RP-1079; there the Record, which
--   prints a shared event's files only, holds less than those two read live). Links have no reply rows.
--
-- Rebuilt from main's newest bodies: app.item_row_as_arrived (20261110000000_sent_back_as_it_was.sql,
-- read through app.item_row_seen by the document and work_item_link policies, app.work_item_links, the
-- documents' other readers, and directly by Linked from); the member_reads_documents policy,
-- app.document_times and app.work_item_shared_documents (20271101000000_reply_files_event_audience.sql);
-- app.raised_from_check_item_photos (20271104000000_raised_from_check_item_photos.sql); and
-- app.work_item_shared_links (20270117000400_list_row_commands.sql). Each changes only its arrival rule.
-- Not changed: the Record's own rule; the answers and Trade, Location and Scopes a holder changed after
-- the last arrival, which a close still shares and the Record prints (RP-1149, for the owner to decide);
-- app.transition_validation_failed and app.start_annotated_copy_upload, which act on open items only;
-- the Snag Report's reads (RP-1078 holds them), whose photos are a Snag's own, added before it arrived:
-- they check photos with app.item_row_seen alone, so a closing Code's reply photo would leave a report
-- "gone" (it fails closed; app.document_seen is their rule to take up); app.create_revision, which copies
-- only the raiser's own Form and Attachments files (a reply file's key is never the Form's).
-- An item closed before arrivals were counted (backfilled to 1 in 20261110000000) shows its other
-- Participants none of its rows now, as its Record would.

-- Whether one of the acting Member's Participants held closed item `p_work_item_id` at its close: a Step
-- of its marked done at the moment the item closed. Security invoker: only app.item_row_as_arrived, a
-- definer function, calls it.
create function app.held_at_close(p_work_item_id uuid) returns boolean
  language plpgsql stable
  set search_path = pg_catalog, public
  as $$
    begin
      return exists (
        select 1 from work_item w
        join step_assignment a on a.work_item_id = w.id
        where w.id = p_work_item_id and w.closed_at is not null
          and a.status = 'done' and a.done_at = w.closed_at
          and a.participant_id in (select app.current_participant_ids())
      );
    end
  $$;
revoke all on function app.held_at_close(uuid) from public;

-- As in 20261110000000_sent_back_as_it_was.sql, with a closed item read as it was at its last arrival.
-- The Participant holding the item, or holding it at its close, reads it as it is now (nothing removed);
-- everyone else reads the rows the item had when it last arrived with them (a removed one included, an
-- added one not). Whether they see the item is the caller's to check.
create or replace function app.item_row_as_arrived(p_work_item_id uuid, p_arrival integer, p_removed boolean) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if app.holds_work_item(p_work_item_id) or app.held_at_close(p_work_item_id) then
        return not p_removed;
      end if;
      return exists (
        select 1 from work_item w
        where w.id = p_work_item_id
          -- The close counts one arrival itself, so a closed item's last arrival is `arrivals - 1`; a row
          -- of the close's own arrival was added after it, by Rabaed (a Revision's chain Link), for everyone.
          and case when w.closed_at is null then p_arrival < w.arrivals else p_arrival <> w.arrivals - 1 end
      );
    end
  $$;

-- Whether the acting Member reads a Document of item `p_work_item_id`, added during `p_arrival` and taken
-- by event `p_reply_event_id` (null: no Transition took it): the one rule of every Documents reader below.
-- It sees the item; the row is as the item arrived with them (app.item_row_as_arrived), or a reply file
-- of a closed item, handed over by the event that took it whatever its arrival (the Record's own rule);
-- and that event reaches them (app.reply_event_seen, RP-1079).
create function app.document_seen(p_work_item_id uuid, p_arrival integer, p_reply_event_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return app.sees_work_item(p_work_item_id)
        and (app.item_row_as_arrived(p_work_item_id, p_arrival, false)
          or p_reply_event_id is not null and exists (select 1 from work_item w where w.id = p_work_item_id and w.closed_at is not null))
        and app.reply_event_seen(p_work_item_id, p_reply_event_id);
    end
  $$;
revoke all on function app.document_seen(uuid, integer, uuid) from public;
grant execute on function app.document_seen(uuid, integer, uuid) to rabaed_app;

alter policy member_reads_documents on document
  using (confirmed_at is not null and removed_at is null
    and project_id in (select app.current_project_ids())
    and app.sees_work_item(work_item_id)
    and app.document_seen(work_item_id, arrival, reply_event_id));

-- As in 20271101000000_reply_files_event_audience.sql, through app.document_seen (as the policy).
create or replace function app.document_times(p_work_item_id uuid)
  returns table (document_id uuid, uploaded_at timestamptz, seq integer)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        with recursive visible as (
          -- The rows the documents policy shows the acting Member.
          select d.id, d.confirmed_at, d.file_name from document d
          where d.work_item_id = p_work_item_id and d.confirmed_at is not null and d.removed_at is null
            and app.document_seen(d.work_item_id, d.arrival, d.reply_event_id)
        ), origin as (
          -- Each Document back to the one first uploaded, through any copy of a copy.
          select v.id as document_id, v.id as source_id from visible v
          union all
          select o.document_id, c.copied_from_id from origin o join document_copy c on c.document_id = o.source_id
        )
        select v.id, greatest(v.confirmed_at, w.numbered_at),
          (row_number() over (order by v.confirmed_at, v.file_name, v.id))::integer
        from visible v
        join origin o on o.document_id = v.id
          and not exists (select 1 from document_copy c where c.document_id = o.source_id)
        join document s on s.id = o.source_id
        join work_item w on w.id = s.work_item_id
        order by 3;
    end
  $$;

-- As in 20271101000000_reply_files_event_audience.sql: a closed item's as of its last arrival, and the
-- closing Code's reply files, as the Record (app.documents_shared_before_close).
create or replace function app.work_item_shared_documents(p_work_item_id uuid) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    begin
      return query
        select d.id from document d
        join work_item w on w.id = d.work_item_id
        where d.work_item_id = p_work_item_id and app.sees_work_item(w.id) and w.submitted_at is not null
          and d.confirmed_at is not null and d.removed_at is null
          and (case when w.closed_at is null then d.arrival < w.arrivals
            else d.arrival <> w.arrivals - 1 or d.reply_event_id is not null end)
          and app.reply_event_shared(d.work_item_id, d.reply_event_id);
    end
  $$;

-- As in 20270117000400_list_row_commands.sql: a closed item's as of its last arrival.
create or replace function app.work_item_shared_links(p_work_item_id uuid)
  returns table (id uuid, kind text, field_key text, document_number text, subject text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select l.id, l.kind, l.field_key, t.document_number, t.title
        from work_item_link l
        join work_item f on f.id = l.from_id
        join work_item t on t.id = l.to_id
        where l.from_id = p_work_item_id and app.sees_work_item(f.id) and f.submitted_at is not null
          and case when f.closed_at is null then l.arrival < f.arrivals else l.arrival <> f.arrivals - 1 end
          and t.document_number is not null and not app.chain_item_unshared(f.id, t.id)
        -- hidden-sort-key: main's order, unchanged; the order they were added, never a time, which app.work_item_links already gives every reader (floored at the Creation Date, RP-399)
        order by l.created_at, t.document_number collate "C", l.id;
    end
  $$;

-- As in 20271104000000_raised_from_check_item_photos.sql, through app.document_seen (as the policy):
-- the failed check item's photos are the Inspection's own, taken by the Code that closed it.
create or replace function app.raised_from_check_item_photos(p_work_item_id uuid) returns table (document_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      return query
        select distinct s.id
        from work_item_link l
        join document d on d.work_item_id = l.from_id
        join document_copy c on c.document_id = d.id
        join document s on s.id = c.copied_from_id
        where l.from_id = p_work_item_id and l.kind = 'raised_from' and l.item_key is not null and l.removed_at is null
          and s.work_item_id = l.to_id and s.item_key = l.item_key and s.confirmed_at is not null and s.removed_at is null
          and app.sees_work_item(l.to_id)
          -- As member_reads_documents and app.document_times: never an id the reader can't read.
          and app.document_seen(s.work_item_id, s.arrival, s.reply_event_id);
    end
  $$;
