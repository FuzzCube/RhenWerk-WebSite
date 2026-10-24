-- task-22-1 (user request 24.10.2026): staff write customer e-mails directly in the correspondence of a request and may
-- discard a draft again. Only drafts can be deleted; queued, sent or failed messages stay as history. The history keeps
-- an entry with kind and subject so the deletion stays traceable.

create function public.delete_message_draft(message_id uuid, expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked record;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  locked := private.lock_outgoing_message(delete_message_draft.message_id, delete_message_draft.expected_version);

  if (locked.msg).status <> 'draft' then
    raise exception 'Nur Entwürfe können gelöscht werden' using errcode = 'RW422';
  end if;
  if exists (select 1 from public.attachments a where a.message_id = (locked.msg).id) then
    raise exception 'Entwurf mit Anhängen kann nicht gelöscht werden' using errcode = 'RW422';
  end if;
  -- Payment reminders own their message (on delete cascade); they are paused, not deleted
  if exists (select 1 from public.invoice_reminders ir where ir.message_id = (locked.msg).id) then
    raise exception 'Zahlungserinnerungen werden ausgesetzt, nicht gelöscht' using errcode = 'RW422';
  end if;

  delete from public.messages m where m.id = (locked.msg).id;

  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'message_draft_deleted', 'draft', null, null,
    jsonb_build_object('message_id', (locked.msg).id, 'kind', (locked.msg).kind, 'subject', (locked.msg).subject), 'dispatch');
end;
$$;

revoke all on function public.delete_message_draft(uuid, integer) from public, anon;
grant execute on function public.delete_message_draft(uuid, integer) to authenticated;
