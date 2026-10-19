-- task-13-5: e-mail address from the caller's spelling (agent_check_email); agent_create_request stores the checked
-- address instead of the one passed by the model. Run with: supabase test db
begin;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e1@x.test');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000000e1', 'Dispo E', 'dispatcher');

-- Spelling as the speech recognition writes it (the case of the test call on 15.10.2026, final "s" included)
select is(private.email_from_spelling('A, N, D, R, E, J, S, Punkt, S, A, D, K, O, V, O, J, S, @gmail.com.'), 'andrejs.sadkovojs@gmail.com', 'letters, Punkt and @gmail.com');
select is(private.email_from_spelling('a n d r wie Richard e j s punkt s at gmail punkt com'), 'andrejs.s@gmail.com', 'spelling alphabet and spoken at');
select is(private.email_from_spelling('M, Doppel-L, E, R, Bindestrich, K, Unterstrich, eins, at fuzz-cube Punkt de'), 'mller-k_1@fuzz-cube.de', 'double letter, hyphen, underscore, digit word');
select is(private.email_from_spelling('äh, I, N, F, O, ähm, at rheinwerk punkt de'), 'info@rheinwerk.de', 'filler words ignored');
select is(private.email_from_spelling('A, N, D at gmail'), null, 'no top level domain');
select is(private.email_from_spelling('A, Punkt, Punkt, B at x punkt de'), null, 'double dot');

select is(private.spoken_email('andrejs.sadkovojs@gmail.com'), 'A, N, D, R, E, J, S, Punkt, S, A, D, K, O, V, O, J, S, at gmail Punkt com', 'common provider as a word');
select is(private.spoken_email('m-k@fuzz-cube.de'), 'M, Bindestrich, K, at F, U, Z, Z, Bindestrich, C, U, B, E Punkt de', 'other domain spelled');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.agent_check_email('mail-call-1', 'A, N, D, at gmail') ->> 'fehler', 'email_ungueltig', 'invalid spelling is reported');
select is(public.agent_check_email('mail-call-1', 'A, N, D, R, E, J, S, Punkt, S, A, D, K, O, V, O, J, S, at gmail Punkt com') ->> 'email',
  'andrejs.sadkovojs@gmail.com', 'tool returns the address');
-- The model passes a different address: the checked one is stored
select is((public.agent_create_request('mail-call-1', jsonb_build_object('company_name', 'FuzzCube Studio', 'contact_name', 'Andrej',
  'business_email', 'andrejs.sadkovoj@gmail.com', 'phone_number', '0152 26358202', 'street_house_number', 'Weg 2', 'postal_code', '68219',
  'city', 'Mannheim', 'equipment_kind', 'pump', 'service_kind', 'diagnosis_repair', 'customer_urgency', 'planbar',
  'safety_risk', 'none_known', 'description', 'Pumpe fördert nicht.')) ->> 'ok')::boolean, true, 'request created');
reset role;
select is((select business_email from public.requests where source_event_key = 'phone_agent:mail-call-1'), 'andrejs.sadkovojs@gmail.com',
  'request has the checked address');

select * from finish();
rollback;
