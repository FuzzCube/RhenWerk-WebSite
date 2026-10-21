-- Customer number in e-mails to customers (task-15-3): one note line "Ihre Kundennummer: K-… – bitte bei Rückfragen
-- und Anrufen angeben", only when the request is linked to a customer (requests.customer_number is set only then).
-- Receipt and payment reminder templates use the placeholder {{customer_number_note}} (next two migrations, generated
-- by emails/build_*_migration.py); appointment mails get the note in private.queue_hold_mail.

create or replace function private.customer_number_note_text(customer_number text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(btrim(customer_number), '') is null then ''
    else 'Ihre Kundennummer: ' || btrim(customer_number) || E' – bitte bei Rückfragen und Anrufen\nangeben.\n\n' end
$$;

create or replace function private.customer_number_note_html(customer_number text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(btrim(customer_number), '') is null then ''
    else '<p style="margin: 16px 0 0 0; font-size: 15px; line-height: 24px; color: #526574;">Ihre Kundennummer: '
      || '<span style="font-family: ''IBM Plex Mono'', Consolas, ''Courier New'', monospace; font-size: 14px; font-weight: 500; color: #0B1F33; white-space: nowrap;">'
      || private.html_escape(btrim(customer_number)) || '</span> – bitte bei Rückfragen und Anrufen angeben.</p>' end
$$;

-- Reminders: the number printed on the invoice (snapshot at issue), otherwise the one of the linked request
create or replace function private.invoice_customer_number(inv public.invoices, req public.requests) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(inv.customer_snapshot ->> 'customer_number'), ''), req.customer_number)
$$;

-- Confirmation and rejection of a window hold: note before the closing greeting
create or replace function private.queue_hold_mail(req public.requests, subject text, body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  msg public.messages;
begin
  if nullif(btrim(req.business_email), '') is null then return; end if;
  body := replace(body, E'\nMit freundlichen Grüßen', E'\n' || private.customer_number_note_text(req.customer_number) || 'Mit freundlichen Grüßen');
  insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, author_id, approved_by, approved_at)
  values (req.id, 'outgoing', 'other', 'queued', req.business_email, subject, body, (select auth.uid()), (select auth.uid()), now())
  returning * into msg;
  insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, to_value, data)
  values (req.id, 'user', (select auth.uid()), 'message_queued', 'dispatch', 'queued', jsonb_build_object('message_id', msg.id, 'kind', msg.kind));
end;
$$;

revoke all on function private.customer_number_note_text(text), private.customer_number_note_html(text),
  private.invoice_customer_number(public.invoices, public.requests), private.queue_hold_mail(public.requests, text, text)
  from public, anon, authenticated;
