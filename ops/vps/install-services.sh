#!/bin/sh
# Installiert die systemd-Units aus ops/vps/systemd (task-18-2): rheinwerk-watchdog (alle 5 Minuten) und
# rheinwerk-systemcheck (alle 20 Sekunden, „System prüfen“ und „Jetzt sichern“), rheinwerk-backup (täglich 03:00,
# Sicherung mit Probewiederherstellung, task-18-6). Wiederholbar. Protokolle: journalctl -u rheinwerk-watchdog
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
USER_NAME=$(id -un)
for unit in "$DIR"/systemd/*; do
  sed -e "s|__USER__|$USER_NAME|g" "$unit" | sudo tee "/etc/systemd/system/$(basename "$unit")" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now rheinwerk-watchdog.timer rheinwerk-systemcheck.timer rheinwerk-backup.timer
systemctl list-timers 'rheinwerk-*' --no-pager
