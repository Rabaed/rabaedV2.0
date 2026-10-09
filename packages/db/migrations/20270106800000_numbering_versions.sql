-- Custom patterns go back to the Project pattern, and every Project Member reads
-- the versions of the patterns (RP-412 rebuild, spec RP-447; GLOSSARY.md, Numbering
-- Pattern; data-model.md numbering_pattern; visibility.md scenarios RP-412-1 and
-- RP-412-2).
--
-- * numbering_pattern.follows_project: a Work Item Type's row that says the Type
--   uses the Project pattern again from its effective_from ("Use Project pattern" on
--   the Numbering page). Patterns are history, so going back is a new row, not a
--   delete; its pattern columns are null.
-- * app.numbering_pattern_in_effect: as the starting_number_fixes_code migration
--   left it, except that a Type whose newest row follows the Project falls through
--   to the Project's pattern (else the Rabaed Default).
-- * app.apply_numbering_pattern: as the numbering_admin migration left it, except
--   that a Type's save without segments writes a follows_project row. The Project's
--   own pattern still needs segments ('invalid_pattern').
-- * app.numbering_pattern_versions(project, at): the versions of a Project's
--   patterns, for its Project Members: when each took effect, the pattern, and who
--   saved it. The saver's Company is named when it is the reader's own Company or the
--   reader is a Project Admin (who sees every Participant); otherwise not, since a
--   Participant never learns of another (V15), and being the Host Company is no
--   exception: the page says "A Project Admin" (RP-412 review). The saver's
--   name only within the reader's own Company (V14). A Rabaed Engineer's save says so
--   and names nobody.

alter table numbering_pattern
  add column follows_project boolean not null default false,
  alter column segments drop not null,
  alter column separator drop not null,
  alter column seq_digits drop not null,
  alter column seq_scope drop not null,
  drop constraint numbering_pattern_shape,
  drop constraint numbering_pattern_shared_counter_accepted,
  add constraint numbering_pattern_shape check (follows_project or app.is_numbering_pattern(segments, seq_scope)),
  add constraint numbering_pattern_shared_counter_accepted
    check (follows_project or app.counts_by_participant(segments, seq_scope) or shared_counter_accepted_at is not null),
  add constraint numbering_pattern_follows_project check (
    case when follows_project
      then work_item_type_id is not null and segments is null and separator is null and seq_digits is null
        and seq_scope is null and shared_counter_accepted_at is null
      else segments is not null and separator is not null and seq_digits is not null and seq_scope is not null
    end
  );

create or replace function app.numbering_pattern_in_effect(p_project_id uuid, p_work_item_type_id uuid, p_at timestamptz)
  returns table (segments jsonb, separator text, seq_digits smallint, seq_scope jsonb)
  language sql stable
  set search_path = pg_catalog, public
  as $$
    with type_row as (
      select np.segments, np.separator, np.seq_digits, np.seq_scope, np.follows_project
      from numbering_pattern np
      where np.project_id = p_project_id and np.effective_from <= p_at and np.work_item_type_id = p_work_item_type_id
      order by np.effective_from desc, np.id desc
      limit 1
    ), project_row as (
      select np.segments, np.separator, np.seq_digits, np.seq_scope
      from numbering_pattern np
      where np.project_id = p_project_id and np.effective_from <= p_at and np.work_item_type_id is null
      order by np.effective_from desc, np.id desc
      limit 1
    ), chosen as (
      select t.segments, t.separator, t.seq_digits, t.seq_scope from type_row t where not t.follows_project
      union all
      select p.segments, p.separator, p.seq_digits, p.seq_scope from project_row p
      where not exists (select 1 from type_row t where not t.follows_project)
    )
    select * from chosen
    union all
    -- The Rabaed Default: Project, Type, Participant Code, 4 digits, counted by all three.
    select '[{"kind": "project"}, {"kind": "type"}, {"kind": "participant"}]'::jsonb, '-', 4::smallint, '[0, 1, 2]'::jsonb
    where not exists (select 1 from chosen)
  $$;

create or replace function app.apply_numbering_pattern(
  p_project_id uuid, p_work_item_type_id uuid, p_segments jsonb, p_separator text, p_seq_digits integer,
  p_seq_scope jsonb, p_shared_counter_accepted boolean, p_now timestamptz,
  p_set_by_member_id uuid, p_admin_action_id uuid
) returns text
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    declare
      v_at timestamptz := greatest(p_now, now());
    begin
      if not exists (select 1 from project where id = p_project_id) then
        return 'not_found';
      end if;
      if exists (select 1 from project where id = p_project_id and status = 'closed') then
        return 'project_closed';
      end if;
      if p_work_item_type_id is not null and not exists (
        select 1 from work_item_type t
        where t.id = p_work_item_type_id and (t.project_id is null or t.project_id = p_project_id)
      ) then
        return 'type_not_found';
      end if;
      -- A Type uses the Project pattern again from now.
      if p_segments is null and p_work_item_type_id is not null then
        insert into numbering_pattern (
          project_id, work_item_type_id, follows_project, set_by_member_id, admin_action_id, effective_from, created_at
        ) values (
          p_project_id, p_work_item_type_id, true, p_set_by_member_id, p_admin_action_id, v_at, v_at
        );
        return 'saved';
      end if;
      if p_separator is null or p_separator not in ('-', '/') or p_seq_digits is null or p_seq_digits not between 3 and 7
        or not coalesce(app.is_numbering_pattern(p_segments, p_seq_scope), false)
      then
        return 'invalid_pattern';
      end if;
      if not app.counts_by_participant(p_segments, p_seq_scope) and not coalesce(p_shared_counter_accepted, false) then
        return 'shared_counter_not_accepted';
      end if;

      insert into numbering_pattern (
        project_id, work_item_type_id, segments, separator, seq_digits, seq_scope,
        shared_counter_accepted_at, set_by_member_id, admin_action_id, effective_from, created_at
      ) values (
        p_project_id, p_work_item_type_id, p_segments, p_separator, p_seq_digits, p_seq_scope,
        -- Recorded only where the warning applies.
        case when not app.counts_by_participant(p_segments, p_seq_scope) then v_at end,
        p_set_by_member_id, p_admin_action_id, v_at, v_at
      );
      return 'saved';
    end
  $$;

create function app.numbering_pattern_versions(p_project_id uuid, p_at timestamptz)
  returns table (
    work_item_type_id uuid, version_no integer, effective_from timestamptz, follows_project boolean,
    segments jsonb, separator text, seq_digits smallint, seq_scope jsonb,
    by_rabaed boolean, company_name jsonb, member_name jsonb
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_company_id uuid := app.current_company_id();
      v_is_admin boolean;
    begin
      -- Project Members only, as the patterns themselves (numbering_pattern's policy).
      if not exists (select 1 from app.current_project_ids() x where x = p_project_id) then
        return;
      end if;
      v_is_admin := exists (select 1 from app.current_admin_project_ids() x where x = p_project_id);
      return query
        select np.work_item_type_id,
          (row_number() over (partition by np.work_item_type_id order by np.effective_from, np.id))::integer,
          np.effective_from, np.follows_project, np.segments, np.separator, np.seq_digits, np.seq_scope,
          np.admin_action_id is not null,
          case when m.company_id = v_company_id or v_is_admin then c.legal_name end,
          case when m.company_id = v_company_id then m.full_name end
        from numbering_pattern np
        left join member m on m.id = np.set_by_member_id
        left join company c on c.id = m.company_id
        where np.project_id = p_project_id and np.effective_from <= greatest(p_at, now())
        order by np.work_item_type_id nulls first, np.effective_from desc, np.id desc;
    end
  $$;

revoke all on function app.numbering_pattern_versions(uuid, timestamptz) from public;
grant execute on function app.numbering_pattern_versions(uuid, timestamptz) to rabaed_app;
