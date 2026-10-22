#!/bin/sh
# Erzeugt die Geheimnisse des VPS (task-18-2) einmalig auf dem Server, ohne sie auszugeben:
#   /opt/rheinwerk/.env      für docker compose (neue JWT-Schlüssel statt der Demo-Schlüssel des lokalen Stacks)
#   /opt/rheinwerk/ops.env   für Wächter und „System prüfen“ (node --env-file, systemd)
# Vorhandene Dateien bleiben unverändert (neue Schlüssel würden Anmeldungen und gespeicherte Daten ungültig machen).
# Schlüsselerzeugung nach supabase/supabase docker/utils/generate-keys.sh und add-new-auth-keys.sh (Commit a2ee9a9).
set -e
BASE=${RHEINWERK_HOME:-/opt/rheinwerk}
ENV_FILE="$BASE/.env"
OPS_FILE="$BASE/ops.env"
umask 077

if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE besteht bereits, unverändert."
else
  JWT_SECRET=$(openssl rand -base64 30) node -e '
const crypto = require("crypto");
const b64url = (value) => Buffer.from(value).toString("base64url");
const secret = process.env.JWT_SECRET;
const iat = Math.floor(Date.now() / 1000), exp = iat + 5 * 365 * 24 * 3600;
const hs256 = (payload) => {
  const data = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${crypto.createHmac("sha256", secret).update(data).digest("base64url")}`;
};
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const kid = crypto.randomUUID();
const oct = { kty: "oct", k: b64url(secret), alg: "HS256" };
const pub = { kty: "EC", kid, use: "sig", alg: "ES256", ext: true, crv: jwk.crv, x: jwk.x, y: jwk.y };
const es256 = (payload) => {
  const data = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${crypto.sign("SHA256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};
const opaque = (prefix) => {
  const middle = prefix + crypto.randomBytes(17).toString("base64url").slice(0, 22);
  return `${middle}_${crypto.createHash("sha256").update(`supabase-self-hosted|${middle}`).digest("base64url").slice(0, 8)}`;
};
const hex = (n) => crypto.randomBytes(n).toString("hex");
const b64 = (n) => crypto.randomBytes(n).toString("base64");
const lines = {
  POSTGRES_PASSWORD: hex(16),
  JWT_SECRET: secret,
  JWT_EXPIRY: 3600,
  ANON_KEY: hs256({ role: "anon", iss: "supabase", iat, exp }),
  SERVICE_ROLE_KEY: hs256({ role: "service_role", iss: "supabase", iat, exp }),
  SUPABASE_PUBLISHABLE_KEY: opaque("sb_publishable_"),
  SUPABASE_SECRET_KEY: opaque("sb_secret_"),
  ANON_KEY_ASYMMETRIC: es256({ role: "anon", iss: "supabase", iat, exp }),
  SERVICE_ROLE_KEY_ASYMMETRIC: es256({ role: "service_role", iss: "supabase", iat, exp }),
  JWT_KEYS: `'"'"'${JSON.stringify([{ ...pub, key_ops: ["sign", "verify"], d: jwk.d }, oct])}'"'"'`,
  JWT_JWKS: `'"'"'${JSON.stringify({ keys: [{ ...pub, key_ops: ["verify"] }, oct] })}'"'"'`,
  PG_META_CRYPTO_KEY: b64(24),
  DASHBOARD_USERNAME: "supabase",
  DASHBOARD_PASSWORD: hex(16),
};
for (const [key, value] of Object.entries(lines)) console.log(`${key}=${value}`);
' > "$ENV_FILE.tmp"
  cat >> "$ENV_FILE.tmp" <<'EOF'

# Öffentliche Adressen (Cloudflare-Tunnel, betrieb.md 3.1)
SUPABASE_PUBLIC_URL=https://api.rheinwerk-service.online
API_EXTERNAL_URL=https://api.rheinwerk-service.online/auth/v1
SITE_URL=https://rheinwerk-service.online
ADDITIONAL_REDIRECT_URLS=https://rheinwerk-service.online/**,https://www.rheinwerk-service.online/**
N8N_HOST=n8n.rheinwerk-service.online

# Tunnel des Servers: Token aus Cloudflare Zero Trust → Networks → Tunnels (betrieb.md 3.5)
CLOUDFLARE_TUNNEL_TOKEN=

# SMTP für Passwort-Mails von Supabase Auth (task-18-4): Gmail mit App-Passwort, Absender = SMTP_USER
SMTP_ADMIN_EMAIL=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=RheinWerk
EOF
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "$ENV_FILE erzeugt."
fi

if [ -f "$OPS_FILE" ]; then
  echo "$OPS_FILE besteht bereits, unverändert."
else
  SECRET=$(grep '^SUPABASE_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)
  cat > "$OPS_FILE" <<EOF
# Wächter und „System prüfen“ auf dem VPS (scripts/ops, systemd-Timer rheinwerk-*). Fehlende Werte nach dem Umzug
# (task-18-3) aus .env.local des Rechners ergänzen, danach: sudo systemctl restart rheinwerk-watchdog.service
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=$SECRET
DOCKER_COMPOSE_PROJECT=rheinwerk
SUPABASE_REQUIRED_SERVICES=db,kong,auth,rest,storage
SUPABASE_DB_CONTAINER=supabase_db_rheinwerk
SUPABASE_STORAGE_CONTAINER=supabase_storage_rheinwerk
N8N_CONTAINER=rheinwerk-n8n
N8N_API_URL=http://127.0.0.1:5678
# Tägliche Sicherung (task-18-6, docs/betrieb.md 4): 14 Tage, verschlüsselt mit BACKUP_PASSPHRASE (unten ergänzen)
BACKUP_DIR=$BASE/backups
BACKUP_KEEP_DAYS=14
SUPABASE_STORAGE_PATH=/var/lib/storage
BACKUP_SECRET_FILES=$BASE/.env,$BASE/ops.env
# Zustand der Sicherung von OVHcloud (nur lesend, eu.api.ovh.com/createToken): OVH_APPLICATION_KEY,
# OVH_APPLICATION_SECRET, OVH_CONSUMER_KEY
OPS_LOG_DIR=$BASE/state
DISK_WARN_GB=8
DISK_CRITICAL_GB=3
# Website auf Vercel erst ab task-18-4: bis dahin wird sie nicht geprüft
WEBSITE_URL=off
HEALTH_TOKEN=
# Leer = keine Warn-E-Mails (bis zum Umzug, task-18-3, damit Rechner und Server nicht doppelt melden)
ALERT_EMAILS=
SMTP_USER=
SMTP_APP_PASSWORD=
N8N_API_KEY=
ELEVENLABS_API_KEY=
AGENT_WEBHOOK_SECRET=
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=
EOF
  echo "$OPS_FILE erzeugt."
fi
