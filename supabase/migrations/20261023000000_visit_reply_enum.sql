-- task-20-10: own automation step for customer replies about a planned visit (cancellation by e-mail), and a marker
-- for e-mails the system sends from a fixed template without a person's approval (like the receipt).
-- Separate file: a new enum value may only be used after its transaction has committed.
alter type public.automation_step add value if not exists 'visit_reply';

alter table public.messages add column if not exists system_template text;
comment on column public.messages.system_template is 'Fixed template the system sent without approval by a person (task-20-10, e.g. visit_cancelled); claim_queued_messages releases such messages like receipts.';
