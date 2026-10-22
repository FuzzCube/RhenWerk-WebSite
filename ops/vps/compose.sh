#!/bin/sh
# docker compose für RheinWerk auf dem VPS (task-18-2): Compose-Datei aus dem Repository, Geheimnisse aus
# /opt/rheinwerk/.env (nie im Repository). Beispiele: ops/vps/compose.sh ps, ops/vps/compose.sh up -d,
# ops/vps/compose.sh logs --since 30m auth
# Nach einem gescheiterten Systemupdate (task-18-8) hält /opt/rheinwerk/state/images.override.yml einzelne Dienste auf
# dem Image von vorher; sie wird als zweite Compose-Datei gelesen (scripts/ops/images.mjs).
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
OVERRIDE=${OPS_LOG_DIR:-/opt/rheinwerk/state}/images.override.yml
if [ -f "$OVERRIDE" ]; then
  exec docker compose -f "$DIR/docker-compose.yml" -f "$OVERRIDE" --env-file "${RHEINWERK_ENV:-/opt/rheinwerk/.env}" "$@"
fi
exec docker compose -f "$DIR/docker-compose.yml" --env-file "${RHEINWERK_ENV:-/opt/rheinwerk/.env}" "$@"
