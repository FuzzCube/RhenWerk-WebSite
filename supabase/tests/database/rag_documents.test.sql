-- task-18-10: knowledge base of the website assistant. Only service_role (n8n) reads, writes and searches; anon and
-- staff get nothing (the website asks through /api/assistant). match_rag_documents returns the nearest sections first
-- and filters by metadata.
-- Run with: supabase test db
begin;
select plan(8);

delete from public.rag_documents;
insert into public.rag_documents (content, metadata, embedding) values
  ('Inspektion kostet 189 Euro', '{"file": "Leistungen_und_Preise.md"}', array_fill(0.1::real, array[3072])::extensions.vector),
  ('Impressum', '{"file": "Impressum.md"}', (array_fill(0.1::real, array[3071]) || array[5::real])::extensions.vector);

set local role anon;
select throws_ok($$select count(*) from public.rag_documents$$, '42501', null, 'anon reads nothing');
select throws_ok($$select * from public.match_rag_documents(array_fill(0.1::real, array[3072])::extensions.vector, 1)$$, '42501', null, 'anon cannot search');
reset role;
set local role authenticated;
select throws_ok($$select count(*) from public.rag_documents$$, '42501', null, 'staff reads nothing');
select throws_ok($$insert into public.rag_documents (content, embedding) values ('x', array_fill(0::real, array[3072])::extensions.vector)$$, '42501', null, 'staff writes nothing');
reset role;

set local role service_role;
select is((select content from public.match_rag_documents(array_fill(0.1::real, array[3072])::extensions.vector, 1)), 'Inspektion kostet 189 Euro', 'nearest section first');
select is((select count(*) from public.match_rag_documents(array_fill(0.1::real, array[3072])::extensions.vector, 5))::int, 2, 'match_count limits');
select is((select metadata ->> 'file' from public.match_rag_documents(array_fill(0.1::real, array[3072])::extensions.vector, 5, '{"file": "Impressum.md"}')), 'Impressum.md', 'filter by metadata');
select throws_ok($$insert into public.rag_documents (content, embedding) values ('x', array_fill(0::real, array[10])::extensions.vector)$$, '22000', null, 'wrong dimension rejected');
reset role;

select * from finish();
rollback;
