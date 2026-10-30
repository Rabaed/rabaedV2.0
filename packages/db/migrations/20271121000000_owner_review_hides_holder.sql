-- RP-1138 (ADR 0022; visibility.md "With Owner review", V14; scenario RP-598-1): while an item
-- waits for the Owner's review, no holder reaches anyone who reads it "With Owner review".
-- app.with_owner_review_unchecked gives that label to everyone but the review's holder and the
-- Consultant whose Recommendation brought it there; until now only the api put the label in place
-- of the holder, and the database still handed the holding Participant (and so its Company's name)
-- to the Contractor. Both functions start from their newest bodies (20271019000000_reads_at_scale
-- and 20261108000000_plpgsql_definer_helpers).
--
-- * app.work_item_holder_unchecked: gives no holder to a reader the label reaches. It feeds
--   app.work_item_holder (the item's "With" and its map) and app.work_items_seen (the List row's
--   holder_participant_id, holder_member_id and holder_company_name, which the List, its search,
--   the Kanban and the "With" filter read). The holder and the recommending Consultant read it as
--   before.
-- * app.work_item_companies: leaves out the review Step's assignments for such a reader: they name
--   its holder (a pooled, picked-up or vacant row, and a row reassigned within the holder's Company).
--   The item's raiser and the actors of the events the reader sees stay, so a Company that acted
--   on the item where the reader sees it is still named.

create or replace function app.work_item_holder_unchecked(p_work_item_id uuid, p_participant_ids uuid[])
  returns table(participant_id uuid, assignee_member_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    begin
      -- "With Owner review" in place of the holder: no holder reaches the reader.
      if app.with_owner_review_unchecked(p_work_item_id, p_participant_ids) is not null then
        return;
      end if;
      return query
        select a.participant_id,
          case when a.participant_id = any(p_participant_ids) then a.assignee_member_id end
        from step_assignment a
        where a.work_item_id = p_work_item_id and a.status in ('pooled', 'picked_up', 'vacant');
    end
  $$;

create or replace function app.work_item_companies(p_work_item_id uuid) returns table(participant_id uuid, legal_name jsonb)
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      -- The reader reads the item "With Owner review": the review Step's assignments name its holder.
      v_owner_review boolean := app.with_owner_review_unchecked(p_work_item_id, array(select app.current_participant_ids())) is not null;
    begin
      return query
        select p.id, co.legal_name
        from participant p
        join company co on co.id = p.company_id
        where app.sees_work_item(p_work_item_id)
          and p.id in (
            select w.raised_by_participant_id from work_item w where w.id = p_work_item_id
            union
            select a.participant_id from step_assignment a
            where a.work_item_id = p_work_item_id
              and not (v_owner_review and a.step_id = (select w.current_step_id from work_item w where w.id = p_work_item_id))
            union
            select e.actor_participant_id from work_item_event e
            where e.work_item_id = p_work_item_id
              and (e.audience = 'shared' or e.audience_participant_id in (select app.current_participant_ids()))
          );
    end
  $$;
