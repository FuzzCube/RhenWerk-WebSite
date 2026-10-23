-- task-20-14 (user request 23.10.2026): unread customer messages. A customer's e-mail on a request (cancel, move, a
-- question) must show on the planning board, in the request list and on the request page until a person has read it.
-- messages.handled_at stays what it is (processed by the automation or a person); staff_read_at says that staff read it.

alter table public.messages
  add column staff_read_at timestamptz,
  add column staff_read_by uuid references public.profiles (id) on delete restrict;
comment on column public.messages.staff_read_at is 'incoming messages of a request: when staff marked it as read; null = unread (task-20-14)';

-- What exists now counts as read, otherwise every old customer e-mail would show as new
update public.messages set staff_read_at = coalesce(received_at, created_at) where direction = 'incoming' and request_id is not null;

-- Fast lookup of what is still unread (a few rows among thousands of messages)
create index messages_unread_idx on public.messages (request_id) where direction = 'incoming' and staff_read_at is null and archived_at is null;

-- Unread customer e-mails per request. The e-mail a request was created from (received before the request exists)
-- is not "new"; archived ones do not count. The view runs with owner rights and checks access itself (staff who may
-- open the request): the row-by-row RLS of messages would test every outgoing message too and made each page slow.
create view public.request_unread_messages as
select m.request_id,
  count(*)::integer as unread_count,
  min(coalesce(m.received_at, m.created_at)) as oldest_at,
  max(coalesce(m.received_at, m.created_at)) as latest_at
from public.messages m
join public.requests r on r.id = m.request_id
where m.direction = 'incoming' and m.staff_read_at is null and m.archived_at is null
  and coalesce(m.received_at, m.created_at) > r.created_at
  and private.current_employee_role() in ('dispatcher', 'manager', 'admin')
  and private.can_access_request(m.request_id)
group by m.request_id;

comment on view public.request_unread_messages is 'Ungelesene Kundennachrichten je Anfrage (task-20-14); Besitzerrechte, Zugriff über can_access_request geprüft.';
revoke all on public.request_unread_messages from public, anon, authenticated;
grant select on public.request_unread_messages to authenticated;

-- Mark all incoming messages of a request as read (dispatcher of the request, manager, admin)
create function public.mark_request_messages_read(request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked integer;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if not private.can_access_request(mark_request_messages_read.request_id) then
    raise exception 'Anfrage nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  update public.messages m set staff_read_at = now(), staff_read_by = (select auth.uid())
  where m.request_id = mark_request_messages_read.request_id and m.direction = 'incoming' and m.staff_read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke all on function public.mark_request_messages_read(uuid) from public, anon;
grant execute on function public.mark_request_messages_read(uuid) to authenticated;

-- An inbox conversation linked to a request by a person has been read by that person
create or replace function private.move_inbox_conversation(root_id uuid, target_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.messages m
  set request_id = target_request_id, handled_at = case when m.direction = 'incoming' then coalesce(m.handled_at, now()) else m.handled_at end,
    staff_read_at = case when m.direction = 'incoming' then coalesce(m.staff_read_at, now()) else m.staff_read_at end,
    staff_read_by = case when m.direction = 'incoming' and m.staff_read_at is null then (select auth.uid()) else m.staff_read_by end
  where (m.id = root_id or m.inbox_root_id = root_id) and m.request_id is null;
  get diagnostics moved = row_count;
  update public.attachments a set request_id = target_request_id
  where a.request_id is null and a.message_id in (select m.id from public.messages m where m.id = root_id or m.inbox_root_id = root_id);
  return moved;
end;
$$;
