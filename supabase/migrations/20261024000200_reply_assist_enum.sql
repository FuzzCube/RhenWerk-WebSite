-- task-22-3: own automation step for the reply assistant (separate migration: a new enum value is usable after commit)
alter type public.automation_step add value if not exists 'reply_assist';
