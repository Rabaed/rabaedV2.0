-- RP-582: while an item is Sent Back to its raiser, everyone else reads its Trade, Location and
-- Scopes as they were at the Send Back (ADR 0021; visibility.md V12, V19, layer 4, scenarios
-- RP-582-1 and RP-582-2; data-model.md work_item).
--
-- At a Step that says "After a Send Back: Edit the Form" (RP-580) the raiser may change them, and
-- they applied live: another Participant's Members gained or lost the item, and saw its new
-- Location in rows and search, before the raiser Submitted it again. Answers already keep what
-- they were for everyone but the holder (data_as_arrived); this does the same for the tables.
--
-- A snapshot, not an arrival stamp per row (as Documents and Links have): app.set_work_item_built_ins
-- deletes and inserts the rows on every save, and Trade and Location are one value each, so a
-- stamped row would need a "removed" twin per change; one jsonb taken before the first change of an
-- arrival, and cleared when the item leaves the Participant, is the whole state, as data_as_arrived is.
--
-- * work_item.built_ins_as_arrived: `{"dimensions": {<dimension_id>: <value_id>}, "scopes": [<scope_id>]}`,
--   taken by app.set_work_item_built_ins before it changes a Submitted item's rows (only the raiser's
--   holder saves after the first Submit, and only after a Send Back), cleared with data_as_arrived by
--   app.share_answers_on_leaving. The app role reads the column: it holds only what everyone who sees
--   the item saw at the Send Back.
-- * Layer 4 of app.sees_work_item reads, for a reader whose Participant doesn't hold the item, the
--   snapshot's values while there is one; the holder's Members read the rows as they are now. At the
--   next Submit the snapshot is gone and the new values apply to everyone (V12).
-- * The policies on work_item_dimension_value and work_item_scope hide the rows as they are now from
--   everyone but the holder's Participant while there is a snapshot.
-- * work_item_dimension_value_seen and work_item_scope_seen (views, security invoker): the rows each
--   reader may know, the snapshot's for everyone but the holder. The api's List, Kanban, Home,
--   Dashboard, item read and filters, sorts and search read these, never the tables.
-- * app.refresh_work_item_search indexes the snapshot's Trade and Location while there is one, so
--   a search finds the item only under the names everyone else may know; it runs again when the
--   snapshot is taken or cleared.
--
-- Rebuilt from their latest bodies: app.sees_work_item (20270114000000_holder_edits_form.sql),
-- app.set_work_item_built_ins (20261012000000_built_in_fields.sql), app.share_answers_on_leaving
-- (20261110000000_sent_back_as_it_was.sql), app.refresh_work_item_search and the trigger
-- work_item_search_item (20261203000000_work_item_search.sql); the policies from
-- 20260929000000_work_items.sql and 20261012000000_built_in_fields.sql.

alter table work_item add column built_ins_as_arrived jsonb;
-- What everyone who sees the item saw at the Send Back; the views and the policies below read it as the app role.
grant select (built_ins_as_arrived) on work_item to rabaed_app;

-- The snapshot ------------------------------------------------------------------------------

-- As in 20261012000000_built_in_fields.sql, first keeping a Submitted item's values as they were
-- when it arrived at its holder (the first change of the arrival takes it; later ones keep it).
create or replace function app.set_work_item_built_ins(
  p_work_item_id uuid, p_project_id uuid, p_trade_id uuid, p_location_id uuid, p_scope_ids uuid[]
) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_trade_dimension uuid := app.project_dimension_id(p_project_id, 'trade');
      v_location_dimension uuid := app.project_dimension_id(p_project_id, 'location');
      v_scope_ids uuid[] := array(select distinct x from unnest(coalesce(p_scope_ids, '{}')) x where x is not null);
    begin
      update work_item w set built_ins_as_arrived = jsonb_build_object(
          'dimensions', coalesce((
            select jsonb_object_agg(dv.dimension_id, dv.dimension_value_id)
            from work_item_dimension_value dv where dv.work_item_id = w.id), '{}'::jsonb),
          'scopes', coalesce((select jsonb_agg(ws.scope_id order by ws.scope_id) from work_item_scope ws where ws.work_item_id = w.id), '[]'::jsonb))
      where w.id = p_work_item_id and w.submitted_at is not null and w.built_ins_as_arrived is null;

      delete from work_item_dimension_value
      where work_item_id = p_work_item_id and dimension_id in (v_trade_dimension, v_location_dimension);
      insert into work_item_dimension_value (work_item_id, project_id, dimension_id, dimension_value_id)
      select p_work_item_id, p_project_id, d.dimension_id, d.value_id
      from (values (v_trade_dimension, p_trade_id), (v_location_dimension, p_location_id)) as d (dimension_id, value_id)
      where d.value_id is not null;

      delete from work_item_scope where work_item_id = p_work_item_id and scope_id <> all (v_scope_ids);
      insert into work_item_scope (work_item_id, project_id, scope_id)
      select p_work_item_id, p_project_id, x from unnest(v_scope_ids) x
      on conflict do nothing;
    end
  $$;

-- As in 20261110000000_sent_back_as_it_was.sql: leaving the Participant (or closing) shares the
-- built-ins too, as the answers.
create or replace function app.share_answers_on_leaving() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      if new.participant_entered_at is distinct from old.participant_entered_at
        or new.participant_entered_step_id is distinct from old.participant_entered_step_id
        or (new.closed_at is not null and old.closed_at is null)
      then
        new.data_as_arrived := null;
        new.built_ins_as_arrived := null;
        new.arrivals := old.arrivals + 1;
      end if;
      return new;
    end
  $$;

-- Who may know which values ------------------------------------------------------------------

-- As in 20270114000000_holder_edits_form.sql; layer 4 reads, for a reader whose Participant doesn't
-- hold the item, its values as at the Send Back while it has them (RP-582).
create or replace function app.sees_work_item(p_work_item_id uuid) returns boolean
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      return (
        select exists (
          select 1
          from work_item w
          join project_member pm on pm.project_id = w.project_id
          join participant p on p.id = pm.participant_id
          join work_item_access a on a.work_item_id = w.id and a.participant_id = pm.participant_id
          join participant raiser on raiser.id = w.raised_by_participant_id
          join project_role raiser_role on raiser_role.id = raiser.project_role_id
          join workflow_step s on s.id = w.current_step_id
          -- Whether the reader's Participant holds it: then it reads the values as they are now.
          cross join lateral (
            select w.built_ins_as_arrived is null or exists (
              select 1 from step_assignment h
              where h.work_item_id = w.id and h.status in ('pooled', 'picked_up', 'vacant') and h.participant_id = pm.participant_id
            ) as live
          ) reads
          where w.id = p_work_item_id
            and w.project_id in (select app.current_project_ids())
            and pm.member_id = app.current_member_id() and pm.status = 'active'
            and p.status = 'active' and p.company_id = app.current_company_id()
            and (p.id = w.raised_by_participant_id or w.submitted_at is not null
              or s.actor_rule ->> 'base_role' is distinct from raiser_role.base_role)
            and (w.document_number is not null or s.drafts_visible_to is distinct from 'author'
              or exists (
                select 1 from step_assignment h
                where h.work_item_id = w.id and h.status = 'picked_up' and h.assignee_member_id = pm.member_id))
            and not exists (
              select 1 from work_item_dimension_value dv
              where reads.live and dv.work_item_id = w.id
                and dv.dimension_value_id not in (select app.values_covered_by_project_member(pm.id, dv.dimension_id))
            )
            and not exists (
              select 1 from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
              where not reads.live
                and v.value::uuid not in (select app.values_covered_by_project_member(pm.id, v.key::uuid))
            )
        )
      );
    end
  $$;

-- The policies and views below ask it as the app role. It answers only whether the caller's own
-- Participant holds the item, which a holder sees anyway and nobody else learns anything from.
grant execute on function app.holds_work_item(uuid) to rabaed_app;

-- The rows as they are now: while the item has a snapshot, its holder's Participant only.
drop policy member_reads_visible_work_item_values on work_item_dimension_value;
create policy member_reads_visible_work_item_values on work_item_dimension_value for select to rabaed_app
  using (work_item_id in (select w.id from work_item w where w.built_ins_as_arrived is null or app.holds_work_item(w.id)));
drop policy member_reads_visible_work_item_scopes on work_item_scope;
create policy member_reads_visible_work_item_scopes on work_item_scope for select to rabaed_app
  using (work_item_id in (select w.id from work_item w where w.built_ins_as_arrived is null or app.holds_work_item(w.id)));

-- An item's dimension values and Scopes as the reader may know them: as they are now (the tables,
-- through the policies above), or, for everyone but the holder's Participant while the item has a
-- snapshot, the snapshot's. Security invoker, so work_item's own row-level security (V1 to V5)
-- decides which items; read by the app role.
create view work_item_dimension_value_seen with (security_invoker = true) as
  select dv.work_item_id, dv.project_id, dv.dimension_id, dv.dimension_value_id
  from work_item_dimension_value dv
  union all
  select w.id, w.project_id, v.key::uuid, v.value::uuid
  from work_item w
  cross join lateral jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') v
  where w.built_ins_as_arrived is not null and not app.holds_work_item(w.id);

create view work_item_scope_seen with (security_invoker = true) as
  select ws.work_item_id, ws.project_id, ws.scope_id
  from work_item_scope ws
  union all
  select w.id, w.project_id, s.value::uuid
  from work_item w
  cross join lateral jsonb_array_elements_text(w.built_ins_as_arrived -> 'scopes') s
  where w.built_ins_as_arrived is not null and not app.holds_work_item(w.id);

revoke all on work_item_dimension_value_seen, work_item_scope_seen from public;
grant select on work_item_dimension_value_seen, work_item_scope_seen to rabaed_app;

-- Search ---------------------------------------------------------------------------------------

-- As in 20261203000000_work_item_search.sql, with the snapshot's Trade and Location while the item
-- has one: one row per item, so it holds only the names everyone who sees it may know.
create or replace function app.refresh_work_item_search(p_work_item_id uuid) returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      insert into work_item_search (work_item_id, project_id, search_text)
      select w.id, w.project_id, concat_ws(' ',
          w.document_number, w.title,
          t.name ->> 'en', t.name ->> 'ar',
          co.legal_name ->> 'en', co.legal_name ->> 'ar',
          (select string_agg(concat_ws(' ', v.name ->> 'en', v.name ->> 'ar'), ' ' order by d.kind)
           from (
             select dv.dimension_id, dv.dimension_value_id from work_item_dimension_value dv
             where dv.work_item_id = w.id and w.built_ins_as_arrived is null
             union all
             select a.key::uuid, a.value::uuid from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') a
             where w.built_ins_as_arrived is not null
           ) dv
           join visibility_dimension d on d.id = dv.dimension_id
           join dimension_value v on v.id = dv.dimension_value_id
           where d.kind in ('trade', 'location')))
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      join company co on co.id = p.company_id
      where w.id = p_work_item_id
      on conflict (work_item_id) do update set project_id = excluded.project_id, search_text = excluded.search_text;
    end
  $$;

-- As in 20261203000000_work_item_search.sql; a renamed Trade or Location also reaches the items
-- whose snapshot names it.
create or replace function app.work_item_search_on_name() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if tg_table_name = 'dimension_value' then
        perform app.refresh_work_item_search(dv.work_item_id) from work_item_dimension_value dv where dv.dimension_value_id = new.id;
        perform app.refresh_work_item_search(w.id) from work_item w
        where w.built_ins_as_arrived is not null and w.project_id = new.project_id
          and exists (select 1 from jsonb_each_text(w.built_ins_as_arrived -> 'dimensions') a where a.value = new.id::text);
      elsif tg_table_name = 'work_item_type' then
        perform app.refresh_work_item_search(w.id) from work_item w where w.work_item_type_id = new.id;
      elsif tg_table_name = 'company' then
        perform app.refresh_work_item_search(w.id)
        from work_item w join participant p on p.id = w.raised_by_participant_id
        where p.company_id = new.id;
      end if;
      return null;
    end
  $$;

-- As in 20261203000000_work_item_search.sql, and when the snapshot is taken or cleared.
drop trigger work_item_search_item on work_item;
create trigger work_item_search_item
  after insert or update of document_number, title, work_item_type_id, raised_by_participant_id, built_ins_as_arrived
  on work_item for each row execute function app.work_item_search_on_item();
