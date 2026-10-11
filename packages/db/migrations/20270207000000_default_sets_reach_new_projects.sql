-- RP-528 review (owner, 2026-10-11; data-model.md `stage` and `outcome`, workflow-engine.md
-- "Outcomes"): an edit of a Rabaed Default Stage set or outcome set (RP-443, Rabaed Admin ->
-- Workflows) reaches only the Projects created afterwards, an added Stage or outcome included.
--
-- * The triggers that copied a new Rabaed Default Stage (stage_rabaed_default_copied) or
--   outcome (outcome_rabaed_default_copied) into every existing Project are dropped, with
--   their functions. A new Project still copies every Rabaed Default (project_stages,
--   project_outcomes), so it gets the sets as they are when it is created.
-- * A new Rabaed Default Work Item Type is not an edit of a set: its outcome set still
--   reaches every Project, so a Project can run the Type at once. app.seed_type_outcomes
--   (rebuilt from its body in 20270102000000_outcome_sets.sql) now copies it into every
--   Project itself, which the dropped outcome trigger used to do.
-- * A migration that adds a Rabaed Default Stage every existing Project must have calls
--   app.copy_rabaed_stages(project) for each, as the backfill of 20261229000000 does.

drop trigger stage_rabaed_default_copied on stage;
drop function app.copy_rabaed_stage_to_projects();
drop trigger outcome_rabaed_default_copied on outcome;
drop function app.copy_rabaed_outcome_to_projects();

-- A new Type starts with the Rabaed Default set of its outcome kind, owned as the Type is;
-- a new Rabaed Default Type's set is also every Project's own copy.
create or replace function app.seed_type_outcomes() returns trigger
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    begin
      insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
      select new.owner_kind, new.project_id, new.id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
      from app.default_outcomes(new.outcome_kind) d;
      if new.owner_kind = 'rabaed' then
        insert into outcome (owner_kind, project_id, work_item_type_id, code, name, closing, polarity, actions, sort)
        select 'project', p.id, new.id, d.code, d.name, d.closing, d.polarity, d.actions, d.sort
        from project p
        cross join app.default_outcomes(new.outcome_kind) d
        order by p.id, d.sort;
      end if;
      return new;
    end
  $$;
revoke all on function app.seed_type_outcomes() from public;
