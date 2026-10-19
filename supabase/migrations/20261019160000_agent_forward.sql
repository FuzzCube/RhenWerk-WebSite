-- task-13-11: tool weiterleiten of the phone assistant. RheinWerk is a portfolio project without a real phone line
-- (user decision 19.10.2026), so the transfer is a demo: the call is marked as forwarded with its target and reason,
-- and the tool returns a fixed sentence that tells the caller where a real operation would connect them. Mira then
-- offers a callback (rueckruf_service_desk), so the dashboard shows the whole chain. The service desk is only a target
-- within the service hours; the standby service (bereitschaft) is for valid 24/7 contracts (checked by the prompt
-- with sla_pruefen before).

alter table public.phone_calls
  add column forward_target text check (forward_target in ('service_desk', 'bereitschaft')),
  add column forward_reason text,
  add column forwarded_at timestamptz,
  add constraint phone_calls_forward_pair check ((forward_target is null) = (forwarded_at is null) and (forward_target is null or forwarded));
comment on column public.phone_calls.forward_target is 'Ziel der (Demo-)Weiterleitung durch den Telefonassistenten (task-13-11).';

create function public.agent_forward(call_id text, ziel text, grund text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  open_now boolean := private.in_service_hours(now());
  target_text text;
begin
  perform private.require_integration();
  c := private.call_for(agent_forward.call_id);
  if agent_forward.ziel is null or agent_forward.ziel not in ('service_desk', 'bereitschaft') then
    return jsonb_build_object('ok', false, 'fehler', 'ziel_ungueltig');
  end if;
  if agent_forward.ziel = 'service_desk' and not open_now then
    return jsonb_build_object('ok', false, 'fehler', 'ausserhalb_servicezeit',
      'naechste_servicezeit', private.spoken_datetime(private.next_service_start(now())));
  end if;
  update public.phone_calls p set forwarded = true, forward_target = agent_forward.ziel,
    forward_reason = left(nullif(btrim(coalesce(agent_forward.grund, '')), ''), 500),
    forwarded_at = coalesce(p.forwarded_at, now()), in_service_hours = open_now
  where p.id = c.id;
  target_text := case agent_forward.ziel when 'service_desk' then 'unserem Service Desk' else 'unserem Bereitschaftsdienst' end;
  return jsonb_build_object('ok', true, 'demo', true, 'verbunden', false,
    'ansage', 'Dies ist ein Demo-Projekt. In einem echten Betrieb würde ich Sie jetzt mit ' || target_text
      || ' verbinden. Hier ist niemand erreichbar, deshalb nehme ich gern einen Rückruf für Sie auf.');
end;
$$;

revoke all on function public.agent_forward(text, text, text) from public, anon, authenticated;
grant execute on function public.agent_forward(text, text, text) to service_role;
notify pgrst, 'reload schema';
