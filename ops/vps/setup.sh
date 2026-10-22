#!/bin/sh
# Einrichtung des VPS für RheinWerk (task-18-2, docs/betrieb.md 3.5). Wiederholbar; ausführen als Benutzer mit sudo
# (OVHcloud: ubuntu) auf Ubuntu 26.04, nachdem SSH nur mit Schlüssel, ufw (nur 22/tcp) und unattended-upgrades
# eingerichtet sind:
#   curl -fsSL https://raw.githubusercontent.com/FuzzCube/RhenWerk-WebSite/main/ops/vps/setup.sh | sh
# oder nach dem Klonen: sh /opt/rheinwerk/app/ops/vps/setup.sh
# Danach: CLOUDFLARE_TUNNEL_TOKEN in /opt/rheinwerk/.env eintragen, ops/vps/compose.sh up -d
set -e
BASE=/opt/rheinwerk
REPO=https://github.com/FuzzCube/RhenWerk-WebSite.git
USER_NAME=$(id -un)

# 1. Swap 2 GB (für Updates mit Rückfall und Sicherung mit Probewiederherstellung)
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-swap.conf >/dev/null && sudo sysctl -q --system

# 2. Paketquellen Docker (offiziell) und Node.js 24 (NodeSource, für scripts/ops); beide nicht in unattended-upgrades,
#    Updates bewusst mit Rückfall (task-18-8)
. /etc/os-release
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /etc/apt/keyrings/nodesource.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc /etc/apt/keyrings/nodesource.asc
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$VERSION_CODENAME" \
  | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
printf 'Types: deb\nURIs: https://deb.nodesource.com/node_24.x\nSuites: nodistro\nComponents: main\nSigned-By: /etc/apt/keyrings/nodesource.asc\n' \
  | sudo tee /etc/apt/sources.list.d/nodesource.sources >/dev/null
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs git sqlite3 >/dev/null
sudo usermod -aG docker "$USER_NAME"

# 3. Docker für mehrere Projekte: veröffentlichte Ports standardmäßig nur auf 127.0.0.1 (Docker umgeht ufw),
#    Protokolle begrenzt, Container laufen bei einem Neustart des Docker-Dienstes weiter
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "ip": "127.0.0.1",
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
sudo systemctl enable --now docker >/dev/null 2>&1
sudo systemctl restart docker

# 4. Projektordner: Repository (öffentlich, nur lesend), Geheimnisse, Zustand der Dienste
sudo install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$BASE" "$BASE/state" "$BASE/backups"
if [ -d "$BASE/app/.git" ]; then git -C "$BASE/app" pull --ff-only -q; else git clone -q "$REPO" "$BASE/app"; fi
(cd "$BASE/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
sh "$BASE/app/ops/vps/generate-env.sh"

# 5. Wächter und „System prüfen“ als systemd-Timer (statt launchd auf dem Rechner)
sh "$BASE/app/ops/vps/install-services.sh"

echo "Fertig. Nächste Schritte: docs/betrieb.md 3.5"
