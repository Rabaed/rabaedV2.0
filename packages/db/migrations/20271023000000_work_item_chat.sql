-- RP-1062: Chat on a Work Item (spec RP-1054, owner decision C1; GLOSSARY Chat; visibility.md V6 and the Chat row,
-- scenarios RP-1062-1 to RP-1062-5).
--
-- A text-only, insert-only discussion thread on a Work Item. Every Participant that currently has access to the item
-- reads it (V6: app.sees_work_item, checked on every read, so a Member who loses access stops reading at once), and
-- any of its Members who sees the item posts, from the item's Submission Date on: before it only the raiser sees the
-- item, so nothing written then could later reach another Company. Another Company's author is read as that
-- Company's name and Project Role only, never its people (V14, CODING_STANDARDS › Visibility); the reader's own
-- Company's authors are named.
--
-- chat_message is not granted to the app role at all: a row policy on item visibility would hand every Participant
-- who sees the item each author's Member id. It is read through app.work_item_chat and written through
-- app.post_chat_message, both security definer, both checking app.sees_work_item first.
-- Files in Chat and Chat notifications are follow-ups (each with its own leak-channel row).

create table chat_message (
  id uuid primary key default gen_random_uuid(),
  -- Orders the thread when two messages share a time; never read outside app.work_item_chat's order by.
  seq bigint generated always as identity,
  work_item_id uuid not null,
  project_id uuid not null,
  -- The author's Participant on the Project, as it was when they posted.
  participant_id uuid not null references participant (id),
  author_member_id uuid not null references member (id),
  body text not null check (body = btrim(body) and body <> '' and char_length(body) <= 4000),
  created_at timestamptz not null,
  constraint chat_message_item_fk foreign key (work_item_id, project_id) references work_item (id, project_id)
);
create index chat_message_thread on chat_message (work_item_id, created_at, seq);
alter table chat_message enable row level security;
revoke all on chat_message from rabaed_app;

-- Insert-only: a message is never edited or deleted (GLOSSARY Chat).
create function app.chat_message_insert_only() returns trigger
  language plpgsql
  set search_path = pg_catalog, public
  as $$
    begin
      raise exception 'chat_message is insert-only' using errcode = '42501';
    end
  $$;
revoke all on function app.chat_message_insert_only() from public;
create trigger chat_message_insert_only before update or delete on chat_message
  for each row execute function app.chat_message_insert_only();

-- Item p_work_item_id's Chat as the calling Member reads it, oldest first; no rows for an item they don't see (or that
-- doesn't exist). The author: of the reader's own Company, the Member's name; of another, its Company's name and
-- Project Role only (member_name null). `mine` marks the reader's own messages. A message's time is never before the
-- item's Submission Date (the Creation Date row), which posting already ensures.
create function app.work_item_chat(p_work_item_id uuid)
  returns table (
    id uuid, author_kind text, member_name jsonb, company_name jsonb, role_base text, role_name jsonb, mine boolean, body text, at timestamptz
  )
  language plpgsql stable security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_member uuid := app.current_member_id();
      v_company uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return;
      end if;
      select m.company_id into v_company from member m where m.id = v_member;
      return query
        select c.id,
          case when p.company_id = v_company then 'own' else 'other' end,
          case when p.company_id = v_company then m.full_name end,
          co.legal_name, r.base_role, r.name,
          c.author_member_id = v_member,
          c.body,
          greatest(c.created_at, w.submitted_at)
        from chat_message c
        join work_item w on w.id = c.work_item_id
        join participant p on p.id = c.participant_id
        join company co on co.id = p.company_id
        join project_role r on r.id = p.project_role_id
        join member m on m.id = c.author_member_id
        where c.work_item_id = p_work_item_id
        order by c.created_at, c.seq;
    end
  $$;
revoke all on function app.work_item_chat(uuid) from public;
grant execute on function app.work_item_chat(uuid) to rabaed_app;

-- The calling Member posts p_body (trimmed) on item p_work_item_id. Outcomes: posted (with the message's id);
-- not_found for an item they don't see or that doesn't exist, alike; project_closed; not_submitted before the
-- item's Submission Date; invalid_body for a body empty once trimmed or longer than 4000 characters. A refusal
-- writes nothing.
create function app.post_chat_message(p_work_item_id uuid, p_body text, p_now timestamptz)
  returns table (outcome text, message_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public
  as $$
    #variable_conflict use_column
    declare
      v_at timestamptz := greatest(p_now, now());
      v_body text := btrim(coalesce(p_body, ''));
      v_item record;
      v_me record;
      v_id uuid;
    begin
      if not app.sees_work_item(p_work_item_id) then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      select w.id, w.project_id, w.submitted_at, pr.status as project_status into v_item
      from work_item w join project pr on pr.id = w.project_id
      where w.id = p_work_item_id;
      select * into v_me from app.acting_project_member(p_work_item_id);
      if v_item.id is null or v_me.project_member_id is null then
        return query select 'not_found'::text, null::uuid;
        return;
      end if;
      if v_item.project_status <> 'active' then
        return query select 'project_closed'::text, null::uuid;
        return;
      end if;
      if v_item.submitted_at is null then
        return query select 'not_submitted'::text, null::uuid;
        return;
      end if;
      if v_body = '' or char_length(v_body) > 4000 then
        return query select 'invalid_body'::text, null::uuid;
        return;
      end if;
      insert into chat_message (work_item_id, project_id, participant_id, author_member_id, body, created_at)
      values (p_work_item_id, v_item.project_id, v_me.participant_id, app.current_member_id(), v_body, greatest(v_at, v_item.submitted_at))
      returning id into v_id;
      return query select 'posted'::text, v_id;
    end
  $$;
revoke all on function app.post_chat_message(uuid, text, timestamptz) from public;
grant execute on function app.post_chat_message(uuid, text, timestamptz) to rabaed_app;
