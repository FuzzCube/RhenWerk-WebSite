#!/bin/sh
# Stellt eine Sicherung des Rechners (scripts/backup.mjs, entschlüsselt und entpackt) auf dem VPS wieder her
# (task-18-3, docs/betrieb.md 3.6): Postgres, Storage-Dateien und n8n mit Schlüssel. Danach zeigen die Workflows auf
# Supabase im Docker-Netz (http://kong:8000 statt http://host.docker.internal:54321) und das Credential
# „RheinWerk Supabase Local“ nutzt den neuen geheimen Schlüssel aus /opt/rheinwerk/.env (ohne ihn auszugeben).
#   sh ops/vps/import-backup.sh /opt/rheinwerk/state/import/rheinwerk-<zeit>
# Achtung (gefunden in task-18-7): pg_restore verliert die revoke-Anweisungen der Migrationen (Standardrechte von
# Supabase), danach die Rechte mit node scripts/restore.mjs --acl <archiv> neu setzen (docs/betrieb.md 4.5).
# n8n bleibt danach gestoppt: erst starten, wenn n8n auf dem Rechner gestoppt ist (sonst laufen Gmail und Zeitpläne
# doppelt).
set -e
SRC=${1:?Ordner der entpackten Sicherung angeben}
DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE="$DIR/compose.sh"
DB=supabase_db_rheinwerk
STORAGE=supabase_storage_rheinwerk
SUPABASE_CREDENTIAL=rwdda8aefff1e947
LOG=/opt/rheinwerk/state/import/restore.log

sudo systemctl stop rheinwerk-watchdog.timer rheinwerk-systemcheck.timer
"$COMPOSE" stop auth rest storage n8n

echo "1. Postgres"
docker cp "$SRC/postgres.dump" "$DB:/tmp/r.dump"
# Erwartet: Meldungen zur Rolle supabase_realtime_admin (kein Realtime auf dem VPS), zu den Schemas storage und
# extensions, die bestehen bleiben, und bei einer Wiederholung „cannot drop inherited constraint messages_<datum>_pkey“
# (Realtime-Partitionen, betrieb.md 4.5)
docker exec "$DB" pg_restore -U supabase_admin -d postgres --clean --if-exists /tmp/r.dump > "$LOG" 2>&1 || true
docker exec "$DB" rm -f /tmp/r.dump
echo "   $(grep -c 'error:' "$LOG") Meldungen, davon $(grep 'error:' "$LOG" | grep -vc 'supabase_realtime_admin\|schema "\{0,1\}storage\|schema "\{0,1\}extensions\|cannot drop inherited constraint') unerwartet ($LOG)"

echo "2. Storage-Dateien"
"$COMPOSE" up -d auth rest storage
sleep 8
docker exec -i "$STORAGE" tar -xzf - -C /var/lib/storage < "$SRC/storage.tar.gz"
docker restart supabase_rest_rheinwerk > /dev/null

echo "3. n8n"
VOLUME=$(docker volume inspect rheinwerk_n8n-data --format '{{.Mountpoint}}')
sudo rm -f "$VOLUME/database.sqlite" "$VOLUME/database.sqlite-wal" "$VOLUME/database.sqlite-shm"
sudo cp "$SRC/n8n-database.sqlite" "$VOLUME/database.sqlite"
[ -s "$SRC/n8n-database.sqlite-wal" ] && sudo cp "$SRC/n8n-database.sqlite-wal" "$VOLUME/database.sqlite-wal"
sudo cp "$SRC/n8n-config" "$VOLUME/config"
sudo sh -c "chown 1000:1000 '$VOLUME'/database.sqlite* '$VOLUME/config'"
sudo chmod 600 "$VOLUME/config"
sudo python3 - "$VOLUME/database.sqlite" <<'EOF'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
for table in ("workflow_entity", "workflow_history"):
    changed = db.execute(f"update {table} set nodes = replace(nodes, 'http://host.docker.internal:54321', 'http://kong:8000') where nodes like '%host.docker.internal:54321%'").rowcount
    print(f"   {table}: {changed} mit neuer Supabase-Adresse")
db.commit()
EOF
SECRET=$(grep '^SUPABASE_SECRET_KEY=' /opt/rheinwerk/.env | cut -d= -f2-)
"$COMPOSE" run --rm --no-deps -T -e NEW_KEY="$SECRET" --entrypoint sh n8n -c "
  n8n export:credentials --id=$SUPABASE_CREDENTIAL --decrypted --output=/tmp/c.json > /dev/null 2>&1
  node -e '
    const fs = require(\"fs\"); const list = JSON.parse(fs.readFileSync(\"/tmp/c.json\"));
    for (const c of list) { c.data.host = \"http://kong:8000\"; c.data.serviceRole = process.env.NEW_KEY; }
    fs.writeFileSync(\"/tmp/c.json\", JSON.stringify(list));
    console.log(\"   Credential: \" + list.map((c) => c.name).join(\", \") + \" auf http://kong:8000 und neuen Schlüssel umgestellt\");'
  n8n import:credentials --input=/tmp/c.json > /dev/null 2>&1
  rm -f /tmp/c.json"

sudo systemctl start rheinwerk-watchdog.timer rheinwerk-systemcheck.timer
echo "Fertig. n8n ist gestoppt; starten mit: ops/vps/compose.sh up -d n8n"
