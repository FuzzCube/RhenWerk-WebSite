-- task-10-10: archive inbox e-mails that do not concern an order (advertising, suppliers, applications, other).
-- Archived e-mails leave the open inbox and its counter but are never deleted; who archived when and why stays on
-- the row. Restoring brings the e-mail back into the open inbox. Rights as for link_message: the owner of the
-- inbox (dispatcher), manager and admin (private.can_read_message).

alter table public.messages
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete restrict,
  add column archive_reason text,
  add constraint messages_archive_reason_check check (archive_reason in ('advertising', 'supplier', 'application', 'other')),
  add constraint messages_archive_complete check ((archived_at is null) = (archive_reason is null) and (archived_at is null) = (archived_by is null)),
  add constraint messages_archive_only_unmatched check (archived_at is null or (request_id is null and direction = 'incoming'));

-- Open inbox: incoming, unmatched, not archived
create index messages_open_inbox_idx on public.messages (received_at desc) where direction = 'incoming' and request_id is null and archived_at is null;

create function public.archive_message(message_id uuid, reason text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if archive_message.reason is null or archive_message.reason not in ('advertising', 'supplier', 'application', 'other') then
    raise exception 'Ungültiger Grund' using errcode = 'RW422';
  end if;

  select * into msg from public.messages m where m.id = archive_message.message_id for update;
  if not found or not private.can_read_message(msg.id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if msg.request_id is not null or msg.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können archiviert werden' using errcode = 'RW422';
  end if;
  -- Repetition (double click): already archived, nothing changes
  if msg.archived_at is not null then
    return msg;
  end if;

  update public.messages m
  set archived_at = now(), archived_by = (select auth.uid()), archive_reason = archive_message.reason, handled_at = now()
  where m.id = msg.id
  returning * into result;
  return result;
end;
$$;

create function public.restore_message(message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into msg from public.messages m where m.id = restore_message.message_id for update;
  if not found or not private.can_read_message(msg.id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if msg.archived_at is null then
    return msg;
  end if;

  update public.messages m
  set archived_at = null, archived_by = null, archive_reason = null, handled_at = null
  where m.id = msg.id
  returning * into result;
  return result;
end;
$$;

-- An archived e-mail is restored before it is assigned; link_message and create_request_from_message refuse it
create function private.reject_archived_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_id is not null and old.request_id is null and old.archived_at is not null and new.archived_at is not null then
    raise exception 'Archivierte E-Mail zuerst wiederherstellen' using errcode = 'RW422';
  end if;
  return new;
end;
$$;

create trigger messages_reject_archived_link
before update of request_id on public.messages
for each row execute function private.reject_archived_link();

revoke all on function public.archive_message(uuid, text), public.restore_message(uuid) from public, anon;
grant execute on function public.archive_message(uuid, text), public.restore_message(uuid) to authenticated;
revoke all on function private.reject_archived_link() from public, anon, authenticated;
notify pgrst, 'reload schema';
