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
-- * app.work_item_companies: an assignment at an Owner's review Step (a `confirm_code` Step) names
--   its holder only to that holder's own Participant and to a Participant whose transition brought
--   the item to that Step (the recommending Consultant), the same two the label leaves out. This
--   holds while the item waits there (a pooled, picked-up or vacant row, or one reassigned within
--   the holder's Company) and after it has left: a Send Back is internal to the Owner and the
--   Consultant, so the review's finished row was the Contractor's only way to OW's name. The
--   item's raiser and the actors of the events the reader sees stay, so a Company that acted on
--   the item where the reader sees it (the Owner's issued Code, its signer) is still named.

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
            join workflow_step s on s.id = a.step_id
            where a.work_item_id = p_work_item_id
              -- The Owner's review names its holder to the holder and to whoever brought the item to it only.
              and (s.outcome_mode is distinct from 'confirm_code'
                or a.participant_id in (select app.current_participant_ids())
                or exists (
                  select 1 from work_item_event e
                  where e.work_item_id = p_work_item_id and e.type = 'transition' and e.to_step_id = a.step_id
                    and e.actor_participant_id in (select app.current_participant_ids())))
            union
            select e.actor_participant_id from work_item_event e
            where e.work_item_id = p_work_item_id
              and (e.audience = 'shared' or e.audience_participant_id in (select app.current_participant_ids()))
          );
    end
  $$;
