-- RP-1117: admin_action.seq, the order Rabaed Engineers' actions were written in (follow-up to RP-1105).
-- Ids are random (ADR 0015) and `at` is the database's clock, which can step back, so `(at, id)` is a total
-- order but not write order: two actions written one after the other could read back swapped. seq is, as
-- chat_message's is. Only reads that show admin history in write order sort by it; `(at, id)` stays the
-- tiebreak elsewhere.
--
-- Who reads admin_action is unchanged (visibility.md V9): rabaed_app has no grant on the table, so none on
-- the new column; rabaed_admin's table-wide select and insert cover it, and an identity column needs no grant
-- on its sequence. "generated always" means no one writes seq by hand.

-- The rows already there are numbered in their (at, id) order, the order they were read in until now. The
-- column gets its identity only afterwards, so its sequence starts after the last of them.
alter table admin_action add column seq bigint;
update admin_action a set seq = o.n
  from (select id, row_number() over (order by at, id) as n from admin_action) o
  where o.id = a.id;
alter table admin_action alter column seq set not null;
alter table admin_action alter column seq add generated always as identity;
select setval(pg_get_serial_sequence('admin_action', 'seq'), coalesce(max(seq), 0) + 1, false) from admin_action;

-- An item's Re-produce requests in the order they were made. As 20271006000000's body; only the sort
-- changes, from (at, id) to seq.
create or replace function app.documental_record_history(p_work_item_id uuid)
  returns table (
    requested_at timestamptz, engineer_email text, reason text, outcome text,
    replaced_sha256 text, new_sha256 text)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return query
        select a.at, e.email, a.reason,
          case
            when x.id is not null then 'replaced'
            when exists (
              select 1 from outbox o
              where o.kind = 'documental_record_reproduce' and o.payload ->> 'admin_action_id' = a.id::text
                and o.processed_at is null and o.dead_at is null
            ) then 'waiting'
            when exists (
              select 1 from outbox o
              where o.kind = 'documental_record_reproduce' and o.payload ->> 'admin_action_id' = a.id::text
                and o.processed_at is not null
            ) then 'checks_failed'
            else 'job_failed'
          end,
          encode(x.replaced_sha256, 'hex'), encode(x.new_sha256, 'hex')
        from admin_action a
        join rabaed_engineer e on e.id = a.engineer_id
        left join documental_record_reproduction x on x.admin_action_id = a.id
        where a.action = 'reproduce_documental_record' and a.target_id = p_work_item_id
          and a.after ->> 'result' = 'queued'
        order by a.seq;
    end
  $$;
