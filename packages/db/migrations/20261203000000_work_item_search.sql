-- Search over the List (RP-347, spec RP-344; visibility.md "Search and filters",
-- V1, V3, V19, scenario 66).
--
-- * work_item_search: one row per Work Item, kept by triggers, holding the text
--   Search looks in: the Document Number, the Subject, the Type's name, the
--   Trade's and Location's names and the raiser's Company name, each in English
--   and Arabic. Never Form answers, nor Documents: answers still being filled in
--   at another Participant's Step (V19) can't be found by searching.
--   A trigram index finds a part of a word (a Document Number's "MAR-00"), a
--   full-text index whole words.
-- * The app role can't read the table at all, so it adds nothing the app role
--   may read beyond the work_item columns it is already granted (CODING_STANDARDS:
--   grant only what every Member who sees the row may read). It searches only
--   through app.search_work_items, which answers with the ids of matching items
--   the caller sees, and nothing about any other.

create extension if not exists pg_trgm with schema public;

create table work_item_search (
  work_item_id uuid primary key references work_item (id) on delete cascade,
  project_id uuid not null,
  search_text text not null,
  search_tsv tsvector generated always as (to_tsvector('simple', search_text)) stored
);
create index work_item_search_trgm_idx on work_item_search using gin (search_text gin_trgm_ops);
create index work_item_search_tsv_idx on work_item_search using gin (search_tsv);
create index work_item_search_project_idx on work_item_search (project_id);

-- Read and written by the triggers below and app.search_work_items only.
alter table work_item_search enable row level security;
revoke all on work_item_search from rabaed_app, rabaed_admin;

-- The item's search text, written again from what it is now.
create function app.refresh_work_item_search(p_work_item_id uuid) returns void
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
           from work_item_dimension_value dv
           join visibility_dimension d on d.id = dv.dimension_id
           join dimension_value v on v.id = dv.dimension_value_id
           where dv.work_item_id = w.id and d.kind in ('trade', 'location')))
      from work_item w
      join work_item_type t on t.id = w.work_item_type_id
      join participant p on p.id = w.raised_by_participant_id
      join company co on co.id = p.company_id
      where w.id = p_work_item_id
      on conflict (work_item_id) do update set project_id = excluded.project_id, search_text = excluded.search_text;
    end
  $$;

create function app.work_item_search_on_item() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      perform app.refresh_work_item_search(new.id);
      return null;
    end
  $$;
create trigger work_item_search_item after insert or update of document_number, title, work_item_type_id, raised_by_participant_id
  on work_item for each row execute function app.work_item_search_on_item();

create function app.work_item_search_on_dimension() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if tg_op in ('UPDATE', 'DELETE') then perform app.refresh_work_item_search(old.work_item_id); end if;
      if tg_op in ('INSERT', 'UPDATE') then perform app.refresh_work_item_search(new.work_item_id); end if;
      return null;
    end
  $$;
create trigger work_item_search_dimension after insert or update or delete
  on work_item_dimension_value for each row execute function app.work_item_search_on_dimension();

-- A renamed Trade or Location, Type or Company reaches every item that names it.
create function app.work_item_search_on_name() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public
  as $$
    begin
      if tg_table_name = 'dimension_value' then
        perform app.refresh_work_item_search(dv.work_item_id) from work_item_dimension_value dv where dv.dimension_value_id = new.id;
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
create trigger work_item_search_name after update of name on dimension_value
  for each row when (old.name is distinct from new.name) execute function app.work_item_search_on_name();
create trigger work_item_search_name after update of name on work_item_type
  for each row when (old.name is distinct from new.name) execute function app.work_item_search_on_name();
create trigger work_item_search_name after update of legal_name on company
  for each row when (old.legal_name is distinct from new.legal_name) execute function app.work_item_search_on_name();

-- Items made before this migration.
select app.refresh_work_item_search(id) from work_item;

-- The ids of the Project's items the caller sees whose search text holds every
-- word of `p_q` (the first ten), in any case. A word of three letters or more
-- may be a part of a word ("MAR-01-00", through the trigram index); a shorter
-- one ("B" of "Building B") must be a whole word (through the full-text index),
-- or nearly everything would match it. Nothing about an item the caller
-- doesn't see, not even that it matched.
create function app.search_work_items(p_project_id uuid, p_q text) returns setof uuid
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_words text[];
      v_conditions text := '';
    begin
      select array_agg(w) into v_words
      from (select w from regexp_split_to_table(btrim(coalesce(p_q, '')), '\s+') w where w <> '' limit 10) words;
      if v_words is null then return; end if;
      for i in 1 .. array_length(v_words, 1) loop
        if char_length(v_words[i]) >= 3 then
          v_words[i] := '%' || regexp_replace(v_words[i], '([\\%_])', '\\\1', 'g') || '%';
          v_conditions := v_conditions || format(' and s.search_text ilike $2[%s]', i);
        elsif numnode(plainto_tsquery('simple', v_words[i])) = 0 then
          -- Punctuation only: no word to find.
          return;
        else
          v_conditions := v_conditions || format(' and s.search_tsv @@ plainto_tsquery(''simple'', $2[%s])', i);
        end if;
      end loop;
      return query execute
        'select s.work_item_id from work_item_search s where s.project_id = $1' || v_conditions
          || ' and app.sees_work_item(s.work_item_id)'
        using p_project_id, v_words;
    end
  $$;

-- Trigger functions: EXECUTE is checked when the trigger is created, not when it fires.
revoke all on function app.refresh_work_item_search(uuid), app.work_item_search_on_item(),
  app.work_item_search_on_dimension(), app.work_item_search_on_name() from public;
revoke all on function app.search_work_items(uuid, text) from public;
grant execute on function app.search_work_items(uuid, text) to rabaed_app;
