-- Payment reminders (task-10-2): own message kind. Separate migration because a new enum value
-- cannot be used in the transaction that adds it.
alter type public.message_kind add value if not exists 'payment_reminder';
