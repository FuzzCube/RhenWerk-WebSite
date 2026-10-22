#!/bin/sh
# Vor jedem Deployment (task-18-5, .github/workflows/ci.yml): Repository auf den Commit setzen, Datenbank sichern und
# nur noch nicht eingespielte Migrationen aus supabase/migrations anwenden. Aufruf durch GitHub Actions über einen
# eigenen SSH-Schlüssel, der in ~/.ssh/authorized_keys nur dieses Skript ausführen darf (command="…"); der Commit
# kommt als SSH_ORIGINAL_COMMAND. Von Hand: sh ops/vps/migrate.sh <commit>
# Nur hinzufügende Migrationen: DROP TABLE/COLUMN/SCHEMA bricht ab, solche Änderungen von Hand mit Sicherung einspielen.
set -eu
SHA=${SSH_ORIGINAL_COMMAND:-${1:-}}
APP=/opt/rheinwerk/app
BACKUPS=/opt/rheinwerk/state/pre-migration
DB=supabase_db_rheinwerk
KEEP=10

case "$SHA" in
  *[!0-9a-f]* | "") echo "Ungültiger Commit: '$SHA'" >&2; exit 2 ;;
esac
[ ${#SHA} -ge 7 ] && [ ${#SHA} -le 40 ] || { echo "Ungültiger Commit: '$SHA'" >&2; exit 2; }

# Nie zwei Läufe gleichzeitig
exec 9>/opt/rheinwerk/state/migrate.lock
flock -w 600 9

psql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
# Versionen im Bereich „System“ neu ermitteln (task-18-8): ein gemergter Dependabot-PR für ein Image zeigt dort sofort
# „Update bereit“; eingespielt wird erst mit „Update einspielen“
versions() {
  (cd "$APP" && node --env-file=/opt/rheinwerk/ops.env --input-type=module \
    -e 'const { refreshVersions } = await import("./scripts/ops/versions-report.mjs"); await refreshVersions();') > /dev/null 2>&1 \
    && echo "   Versionen im Bereich System aktualisiert" || echo "   Versionen nicht aktualisiert (nächster Lauf um 03:00)"
}

echo "1. Repository auf $SHA"
git -C "$APP" fetch -q origin main
git -C "$APP" merge-base --is-ancestor "$SHA" origin/main || { echo "$SHA ist nicht in origin/main" >&2; exit 2; }
LOCK_BEFORE=$(sha256sum "$APP/package-lock.json" | cut -c1-64)
SELF_BEFORE=$(sha256sum "$APP/ops/vps/migrate.sh" | cut -c1-64)
git -C "$APP" reset -q --hard "$SHA"
# Das Skript hat sich mit dem Commit selbst geändert: die neue Fassung ausführen (die laufende Shell liest sonst die alte)
if [ -z "${MIGRATE_REEXEC:-}" ] && [ "$(sha256sum "$APP/ops/vps/migrate.sh" | cut -c1-64)" != "$SELF_BEFORE" ]; then
  MIGRATE_REEXEC=1 SSH_ORIGINAL_COMMAND="$SHA" exec sh "$APP/ops/vps/migrate.sh"
fi
if [ "$(sha256sum "$APP/package-lock.json" | cut -c1-64)" != "$LOCK_BEFORE" ]; then
  (cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
  echo "   npm-Pakete für die Dienste aktualisiert"
fi

PENDING=""
for file in "$APP"/supabase/migrations/*.sql; do
  version=$(basename "$file" | cut -d_ -f1)
  [ -n "$(psql -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ] || PENDING="$PENDING $file"
done
if [ -z "$PENDING" ]; then
  echo "2. Keine neuen Migrationen"
  versions
  exit 0
fi

for file in $PENDING; do
  if grep -Eiq '\bdrop[[:space:]]+(table|column|schema)\b' "$file"; then
    echo "Abbruch: $(basename "$file") löscht Tabellen, Spalten oder Schemas. Von Hand mit Sicherung einspielen (docs/betrieb.md 3.8)." >&2
    exit 3
  fi
done

echo "2. Sicherung vor der Migration"
mkdir -p "$BACKUPS"
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TARGET="$BACKUPS/$(date -u +%Y%m%dT%H%M%SZ)-$(echo "$SHA" | cut -c1-7).dump"
docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc > "$TARGET"
echo "   $TARGET ($(du -h "$TARGET" | cut -f1))"
ls -1t "$BACKUPS"/*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "3. Migrationen"
for file in $PENDING; do
  name=$(basename "$file" .sql)
  psql --single-transaction < "$file"
  psql -c "insert into supabase_migrations.schema_migrations (version, name) values ('${name%%_*}', '${name#*_}')"
  echo "   $name"
done
psql -c "notify pgrst, 'reload schema'"
# In der Liste der Sicherungen im Bereich „System“ (task-18-6; Tabelle besteht ab dieser Migration)
psql -c "insert into public.backups (started_at, reason, status, file_name, size_bytes, contents)
  select '$STARTED', 'migration', 'ok', '$(basename "$TARGET")', $(stat -c %s "$TARGET"),
    jsonb_build_object('commit', '$(echo "$SHA" | cut -c1-7)', 'migrations', $(echo "$PENDING" | wc -w))
  where to_regclass('public.backups') is not null"
versions
echo "Fertig: $(echo "$PENDING" | wc -w) Migration(en)"
