#!/bin/sh
# docker compose für RheinWerk auf dem VPS (task-18-2): Compose-Datei aus dem Repository, Geheimnisse aus
# /opt/rheinwerk/.env (nie im Repository). Beispiele: ops/vps/compose.sh ps, ops/vps/compose.sh up -d,
# ops/vps/compose.sh logs --since 30m auth
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
exec docker compose -f "$DIR/docker-compose.yml" --env-file "${RHEINWERK_ENV:-/opt/rheinwerk/.env}" "$@"
