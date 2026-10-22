-- task-18-9 (Gesamtprobe: Push mit Migration bis Vercel): Kommentar der Tabelle backups um die Anlässe von task-18-7
-- und task-18-8 ergänzt.
comment on table public.backups is 'Sicherungen auf dem VPS (task-18-6); reason: daily, manual, migration (nur Postgres), pre_restore (task-18-7), pre_update (task-18-8); verified: Probewiederherstellung bestanden, null = nicht geprüft';
