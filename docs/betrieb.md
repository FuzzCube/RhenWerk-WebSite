# Betriebskonzept: Betrieb, Datensicherung und Wartung

Diese Seite legt fest, wie RheinWerk dauerhaft läuft, wie Daten gesichert und wiederhergestellt werden und welche Wartung regelmäßig anfällt. Einrichtung der Bausteine: [supabase-lokal.md](supabase-lokal.md), [n8n-workflows.md](n8n-workflows.md), [telefonassistent/setup.md](telefonassistent/setup.md).

## 1. Rahmen und Entscheidung

| Punkt | Festlegung (Nutzerentscheidung 20.10.2026) |
| --- | --- |
| Zweck | Portfolio-Projekt mit Demodaten und realen Testabläufen (Formular, Gmail, Telefonassistent) |
| Kosten | **Stufe 1 ohne laufende Kosten**: keine Server-Miete, kein Supabase-Cloud-Tarif |
| Website | öffentlich unter **`https://rheinwerk-service.online`** |
| n8n und Supabase | vorerst **auf dem eigenen Rechner** (macOS, Docker) |
| Später | **Stufe 2**: Umzug auf einen echten Server, sobald dauerhafte Verfügbarkeit nötig ist |

Bereits vorhanden und genutzt: Domain `rheinwerk-service.online` mit DNS bei Cloudflare, Cloudflare Tunnel (Container `sleepy_margulis`), Cloudflare Access für den n8n-Editor und die Telefon-Webhooks.

## 2. Stufe 1: Betrieb auf dem eigenen Rechner

### 2.1 Aufbau

```mermaid
flowchart LR
  Besucher(["Besucher, Kunden,<br/>Mitarbeitende"]) -->|HTTPS| CF
  Eleven["ElevenLabs „Mira“"] -->|"HTTPS + Service Token"| CF
  subgraph Cloudflare["Cloudflare (kostenlos)"]
    CF["DNS, TLS-Zertifikat,<br/>DDoS-Schutz, Access"]
  end
  CF ==>|"ausgehender Tunnel,<br/>keine offenen Ports"| Tunnel
  subgraph Mac["Eigener Rechner (Docker Desktop)"]
    Tunnel["cloudflared"]
    App["Next.js<br/>next start :3000"]
    N8N["n8n :5678"]
    SB[("Supabase<br/>:54321, nicht öffentlich")]
    Backup["Sicherung täglich<br/>npm run backup"]
    Tunnel -->|"rheinwerk-service.online"| App
    Tunnel -->|"n8n.rheinwerk-service.online<br/>(nur mit Access)"| N8N
    App --> SB
    N8N --> SB
    App -->|Formular| N8N
    Backup -.-> SB & N8N
  end
  Backup -.verschlüsselte Kopie.-> Extern[("Externe SSD<br/>+ Cloud-Ordner")]
```

| Öffentliche Adresse | Ziel im Tunnel | Schutz |
| --- | --- | --- |
| `rheinwerk-service.online` (und `www.`) | `http://host.docker.internal:3000` (Next.js) | öffentlich; Dashboard nur mit Anmeldung, Pause nach Fehlversuchen, RLS |
| `n8n.rheinwerk-service.online` | `http://host.docker.internal:5678` | Cloudflare Access (Anmeldung); nur `webhook/agent-*` per Service Token für ElevenLabs |
| Supabase | – | **nicht veröffentlicht**: Der Browser spricht nie direkt mit Supabase, nur die App auf dem Server und n8n |

`cloudflared` läuft selbst in Docker; deshalb zeigen die Ziele auf `host.docker.internal` statt `localhost`.

**Warum so:** Der Tunnel baut die Verbindung von innen nach außen auf. Im Router wird kein Port geöffnet, die private IP bleibt verborgen, TLS-Zertifikate verwaltet Cloudflare. Supabase bleibt vollständig im lokalen Netz.

### 2.2 Website unter der Domain schalten

1. **Produktionsbuild starten:** `npm run build && npm run start` (Port 3000). Für den Dauerbetrieb als Hintergrunddienst, siehe 2.3.
2. **Tunnel-Route anlegen:** Cloudflare Zero Trust → Networks → Tunnels → Tunnel → *Public Hostname* → `rheinwerk-service.online`, Service `HTTP`, URL `host.docker.internal:3000`; ebenso `www`.
3. **`.env.local` für den Betrieb:**
   - `N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/rheinwerk-service-request` (App und n8n auf demselben Rechner)
   - Turnstile: Produktionsschlüssel für die Domain `rheinwerk-service.online` (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)
   - `BLOB_READ_WRITE_TOKEN` bleibt (Vercel Blob, kostenloser Umfang)
4. **Supabase Auth auf die Domain stellen** (Links in Passwort-Mails): in `supabase/config.toml` `site_url = "https://rheinwerk-service.online"` und die Domain in `additional_redirect_urls`; danach `supabase stop && supabase start` (Daten bleiben erhalten). Für echte Passwort-Mails SMTP nach [setup.md](setup.md#passwort-e-mails-supabase-auth).
5. **Prüfen:** `https://rheinwerk-service.online` öffnen, Formular absenden (RIS-Nummer kommt), unter `/login` anmelden.

### 2.3 Dauerbetrieb des Rechners

| Einstellung | Wo | Zweck |
| --- | --- | --- |
| Ruhezustand verhindern | Systemeinstellungen → Energie → „Automatischen Ruhezustand verhindern, wenn das Display aus ist“ | Tunnel, n8n und Zeitpläne laufen weiter |
| Nach Stromausfall starten | Systemeinstellungen → Energie → „Nach Stromausfall automatisch starten“ | Wiederanlauf ohne Eingriff |
| Docker beim Anmelden starten | Docker Desktop → Settings → General → „Start Docker Desktop when you sign in“ | Container starten selbst |
| Container-Neustart | bereits gesetzt: `restart: unless-stopped` für n8n, cloudflared und die Supabase-Container | nach Docker-Neustart automatisch |
| App als Dienst | `launchd`-Auftrag (unten) | `next start` startet beim Anmelden und nach Absturz neu |

`~/Library/LaunchAgents/online.rheinwerk.web.plist` (Pfade anpassen, `npm run build` vorher ausführen; `zsh -lc` lädt das Benutzerprofil, damit `node`, `docker` usw. im Pfad sind):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>online.rheinwerk.web</string>
  <key>WorkingDirectory</key><string>/Users/NAME/Documents/Code/A.Sadkovojs_Project</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>npm run start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/rheinwerk-web.log</string>
  <key>StandardErrorPath</key><string>/tmp/rheinwerk-web.log</string>
</dict></plist>
```

Aktivieren: `launchctl load ~/Library/LaunchAgents/online.rheinwerk.web.plist`; stoppen: `launchctl unload …`.

### 2.4 Grenzen von Stufe 1 (bewusst akzeptiert)

| Grenze | Folge | Abmilderung |
| --- | --- | --- |
| Rechner aus, im Ruhezustand oder ohne Internet | Website, Dashboard, Formular, Telefonassistent nicht erreichbar | Energieeinstellungen; für Präsentationen vorher prüfen |
| ein Gerät, eine Festplatte | Hardwaredefekt oder Diebstahl = Ausfall | tägliche verschlüsselte Sicherung außerhalb des Rechners (Abschnitt 4) |
| private Internetleitung | begrenzter Upload | für Demo-Last ausreichend; Cloudflare liefert statische Dateien aus dem Cache |
| Wartung am Arbeitsrechner | Neustarts, Updates unterbrechen den Betrieb | Wartung gebündelt (Abschnitt 6) |

**Wiederherstellungsziel Stufe 1:** höchstens 24 Stunden Datenverlust (tägliche Sicherung, RPO), Betrieb auf einem anderen Rechner in etwa 2 Stunden (RTO). E-Mails liegen zusätzlich vollständig in Gmail; die 15-Minuten-Nachlese von Workflow 5 holt Antworten der letzten 7 Tage wieder ein.

## 3. Stufe 2: Umzug auf einen Server

Auslöser für den Umzug: echte Kunden oder Mitarbeitende, Erreichbarkeit rund um die Uhr nötig, oder der Arbeitsrechner soll entlastet werden.

| Variante | Kosten/Monat | Bewertung |
| --- | --- | --- |
| **A. Ein virtueller Server mit Docker Compose** (z. B. Hetzner CX32: 4 vCPU, 8 GB RAM, 80 GB, Rechenzentrum Deutschland) mit Supabase self-hosted, n8n, Next.js, cloudflared | ca. 7–8 € | **empfohlen**: gleiche Container wie heute, Umzug mit den vorhandenen Sicherungsskripten, Daten in Deutschland (DSGVO) |
| B. Oracle Cloud „Always Free“ | 0 € | die kleinen AMD-Instanzen (1 GB RAM) reichen **nicht**; die Ampere-A1-Instanz (bis 4 Kerne, 24 GB RAM) würde reichen, ist aber oft nicht verfügbar, ARM-Images nötig, kein Support |
| C. Verwaltete Dienste: Supabase Cloud (Region Frankfurt) + Vercel + n8n Cloud oder kleiner Server für n8n | 0 € im kostenlosen Umfang, ab ca. 25 € mit Sicherungen | wenig Pflege; kostenloses Supabase pausiert bei Inaktivität und hat keine täglichen Sicherungen |

**Umzug nach Variante A** (mit den Werkzeugen aus Abschnitt 4):

1. Server mit Docker, Firewall (nur SSH mit Schlüssel), automatischen Sicherheitsupdates (`unattended-upgrades`).
2. Repository klonen, Supabase-Stack starten, n8n- und cloudflared-Container wie heute.
3. Letzte Sicherung mit `npm run backup` erstellen, auf den Server kopieren, nach Abschnitt 4.5 wiederherstellen (Postgres, Storage, n8n-Datenbank **mit Schlüssel**).
4. Im Cloudflare-Tunnel die Ziele auf den Server umstellen (oder dort einen neuen Tunnel mit denselben Hostnamen). DNS bleibt unverändert; der Wechsel dauert Minuten.
5. Sicherung auf dem Server per `cron` täglich, Kopie außer Haus (z. B. Hetzner Storage Box, ca. 4 €).

## 4. Datensicherung

### 4.1 Was gesichert wird

| Bestandteil | Inhalt | Wie | Ohne Sicherung verloren? |
| --- | --- | --- | --- |
| Postgres | alle Tabellen inkl. Anmeldedaten (Auth), Storage-Metadaten, Funktionen, pg_cron-Aufträge, Migrationsstand | `pg_dump -Fc` (in sich konsistent, im laufenden Betrieb) | **ja** |
| Storage-Dateien | Formularanhänge, E-Mail-Anhänge, Einsatzfotos (Bucket `dashboard`) | `tar` aus dem Volume des Storage-Containers | **ja** |
| n8n-Datenbank | Workflows, Credentials (verschlüsselt), Ausführungsverlauf | Container `n8n` wird für wenige Sekunden pausiert (`docker pause`), Datenbank samt WAL kopiert, danach lokal zusammengeführt. Die laufende Datenbank wird **nie** vom Rechner aus geöffnet: Am 20.10.2026 hat ein `sqlite3 .backup` vom Mac auf die Live-Datei n8n für zwei Stunden an seiner Schreibsperre hängen lassen (kein Versand, keine Analyse), behoben durch Neustart | Workflows: nein (im Repository), Credentials: **ja** |
| n8n-Schlüssel `~/n8n/data/config` | Schlüssel, mit dem n8n die Credentials verschlüsselt | Dateikopie, **nur in verschlüsselter Sicherung** | **ja** – ohne ihn sind alle Credentials unbrauchbar |
| `.env.local` | Schlüssel für Supabase, Telefonassistent, Cloudflare, Turnstile, Blob | Dateikopie, **nur in verschlüsselter Sicherung** | teilweise neu erzeugbar, aber mühsam |

Nicht in der Sicherung, weil anderswo vorhanden: Quellcode und Workflow-Exporte (GitHub), Docker-Images (werden neu geladen), `node_modules` (`npm ci`), E-Mails (Gmail), Konfiguration der externen Dienste (Cloudflare, Google Cloud, OpenAI, ElevenLabs; in dieser Dokumentation beschrieben).

### 4.2 Sicherung erstellen

```bash
npm run backup
```

Ergebnis: eine Datei `~/RheinWerk-Backups/rheinwerk-<Zeitstempel>.tar.gz.enc` (Stand 20.10.2026: ca. 72 MB, 10 Sekunden) mit `postgres.dump`, `storage.tar.gz`, `n8n-database.sqlite`, `n8n-config`, `env.local` und `manifest.json` (Zeilenzahlen, Prüfsummen).

| Einstellung (`.env.local` oder Umgebung) | Standard | Bedeutung |
| --- | --- | --- |
| `BACKUP_PASSPHRASE` | – | **Pflicht für eine vollständige Sicherung.** Verschlüsselt das Archiv (AES-256, PBKDF2 mit 200 000 Runden). Ohne sie: unverschlüsselt, ohne n8n-Schlüssel und `.env.local`, mit Warnung |
| `BACKUP_DIR` | `~/RheinWerk-Backups` | Zielordner |
| `BACKUP_KEEP` | 14 | Anzahl aufbewahrter Sicherungen; ältere werden gelöscht |
| `N8N_CONTAINER` | `n8n` | Name des n8n-Containers |

> Die Passphrase gehört in einen Passwort-Manager, **nicht nur** in `.env.local`: Ist der Rechner verloren, ist auch `.env.local` weg, und ohne Passphrase lässt sich keine Sicherung öffnen.

### 4.3 Sicherung prüfen (Wiederherstellungstest)

```bash
npm run backup:check            # neueste Sicherung
npm run backup:check -- <datei> # bestimmte Sicherung
```

Der Test entschlüsselt das Archiv, prüft alle Prüfsummen, stellt Postgres in eine **getrennte Datenbank `backup_check`** wieder her, vergleicht die Zeilenzahlen von elf Kerntabellen mit dem Manifest, prüft Passwort-Hashes, Storage-Dateien, die n8n-Datenbank (`integrity_check`, Workflows) und den n8n-Schlüssel. Danach wird `backup_check` gelöscht; die laufenden Daten werden nicht berührt.

Ergebnis vom 20.10.2026: alle Prüfungen bestanden (829 Anfragen, 113 Konten, 2 950 Nachrichten, 53 Storage-Dateien, 28 n8n-Workflows, davon 8 RheinWerk aktiv), Dauer ca. 5 Sekunden.

> Eine Sicherung gilt erst als vorhanden, wenn ihre Wiederherstellung geprüft ist.

### 4.4 Zeitplan und Aufbewahrung (3-2-1-Regel)

| Was | Wann | Wo |
| --- | --- | --- |
| Sicherung + Prüfung | täglich 02:00 (automatisch, `launchd`; verpasste Läufe holt macOS nach dem Aufwachen nach) | `~/RheinWerk-Backups`, 14 Tage |
| Kopie außer Haus | täglich mit (Ordner in iCloud Drive/Google Drive) oder wöchentlich manuell | Cloud-Ordner, verschlüsselt |
| Monatssicherung | am 1. jedes Monats | externe SSD, 12 Monate aufbewahren |

3 Kopien (Original, lokale Sicherung, extern), 2 Medien (interne SSD, externe SSD/Cloud), 1 außer Haus. Weil die Archive verschlüsselt sind, dürfen sie in einen Cloud-Ordner.

`~/Library/LaunchAgents/online.rheinwerk.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>online.rheinwerk.backup</string>
  <key>WorkingDirectory</key><string>/Users/NAME/Documents/Code/A.Sadkovojs_Project</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>npm run backup &amp;&amp; npm run backup:check</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/Users/NAME/RheinWerk-Backups/backup.log</string>
  <key>StandardErrorPath</key><string>/Users/NAME/RheinWerk-Backups/backup.log</string>
</dict></plist>
```

Aktivieren: `launchctl load ~/Library/LaunchAgents/online.rheinwerk.backup.plist`; sofort testen: `launchctl start online.rheinwerk.backup`, danach `tail ~/RheinWerk-Backups/backup.log`.

### 4.5 Wiederherstellung

**Vorher:** App und n8n anhalten, damit niemand schreibt (`launchctl unload …web.plist`, `docker stop n8n`). Die aktuellen Daten zuerst selbst sichern (`npm run backup`), falls die Wiederherstellung rückgängig gemacht werden muss.

```bash
# 0. Archiv entpacken
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in rheinwerk-<zeit>.tar.gz.enc -out r.tar.gz -pass env:BACKUP_PASSPHRASE
tar -xzf r.tar.gz && cd rheinwerk-<zeit>

# 1. Postgres (auf neuem Rechner vorher: supabase start)
docker cp postgres.dump supabase_db_A.Sadkovojs_Project:/tmp/r.dump
docker exec supabase_db_A.Sadkovojs_Project pg_restore -U supabase_admin -d postgres --clean --if-exists /tmp/r.dump
#    erwartet: wenige Meldungen "cannot drop inherited constraint messages_<datum>_pkey" (Realtime-Partitionen, harmlos)

# 2. Storage-Dateien
docker exec -i supabase_storage_A.Sadkovojs_Project tar -xzf - -C /mnt < storage.tar.gz

# 3. n8n (Container gestoppt)
cp n8n-database.sqlite ~/n8n/data/database.sqlite && rm -f ~/n8n/data/database.sqlite-wal ~/n8n/data/database.sqlite-shm
cp n8n-config ~/n8n/data/config
docker start n8n

# 4. Umgebung und Neustart
cp env.local <projekt>/.env.local
docker restart supabase_rest_A.Sadkovojs_Project      # Schema-Cache neu laden
npm run supabase:check && npm run demo:verify
```

Danach: Anmeldung im Dashboard, n8n → Executions (Zeitpläne laufen grün), ein Testformular. Das Verfahren (`--clean` über eine bestehende Datenbank) wurde am 20.10.2026 an der Prüfdatenbank getestet: Zeilenzahlen identisch.

**Kompletter Verlust des Rechners:** neuer Rechner → Voraussetzungen und `supabase start` nach [supabase-lokal.md](supabase-lokal.md) → n8n-Container nach [n8n-workflows.md](n8n-workflows.md#7-einrichtung-von-grund-auf) (ohne Workflows zu importieren) → Schritte 0–4 → Cloudflare-Tunnel-Container mit dem Token aus dem Cloudflare-Konto starten. Ziel: etwa 2 Stunden.

## 5. Überwachung

| Was | Wie | Wer reagiert |
| --- | --- | --- |
| Website erreichbar | kostenloser Uptime-Monitor (z. B. UptimeRobot) auf `https://rheinwerk-service.online`, Benachrichtigung per E-Mail | Betreiber |
| E-Mail-Versand | Hinweis „E-Mail-Versand hängt“ oben im Dashboard nach 10 Minuten (task-12-9) | Dispatcher melden, Betreiber verbindet Gmail neu |
| n8n-Läufe | n8n → Executions, rote Läufe; `docker logs n8n --since 1h` | Betreiber |
| Automatisierung | Dashboard → Auswertung → Automatisierung (Anteil, Läufe mit Fehlern) | Manager |
| Sicherung | `~/RheinWerk-Backups/backup.log`: letzte Zeile „Sicherung ist wiederherstellbar“ | Betreiber, wöchentlich |
| Speicherplatz | `df -h`, `docker system df` | Betreiber, monatlich |

Nächster sinnvoller Ausbau: ein n8n-*Error Workflow*, der bei jedem fehlgeschlagenen Lauf eine E-Mail an den Betreiber schickt (in n8n unter Settings → Error Workflow je Workflow eintragbar).

## 6. Wartungsplan

| Rhythmus | Aufgabe | Befehl / Ort |
| --- | --- | --- |
| täglich (automatisch) | Sicherung + Wiederherstellungstest | `launchd`, Abschnitt 4.4 |
| täglich (automatisch, Datenbank) | Transkripte > 30 Tage, Widget-Sitzungen > 90 Tage löschen; Zahlungserinnerungen; Eskalationen | pg_cron, [supabase-lokal.md](supabase-lokal.md#6-werkzeuge-im-alltag) |
| wöchentlich | `backup.log` prüfen; n8n-Executions auf rote Läufe durchsehen; Dashboard-Hinweise | 5 Minuten |
| monatlich | Sicherheitsupdates: `npm audit`, Next.js-Patchversion, macOS; Monatssicherung auf externe SSD; Kosten bei OpenAI und ElevenLabs prüfen; `docker system df`, alte Images entfernen (`docker image prune`) | [setup.md](setup.md#abhängigkeiten-und-sicherheitsmeldungen) |
| vierteljährlich | n8n-Update (Image-Version erhöhen, Release Notes lesen, vorher Sicherung, danach Executions prüfen); Supabase CLI und Images (`brew upgrade supabase`, `supabase stop && supabase start`); Benutzerkonten prüfen (ausgeschiedene deaktivieren); vollständige Wiederherstellung auf einem zweiten Rechner oder in einer VM üben | |
| jährlich | Geheimnisse erneuern: `AGENT_WEBHOOK_SECRET` (`n8n/bootstrap_agent_secret.py`), Cloudflare-Service-Token für ElevenLabs (läuft nach der eingestellten Dauer ab), OpenAI- und ElevenLabs-Schlüssel; Domain `rheinwerk-service.online` verlängern; Datenschutz-Löschfristen überprüfen | |
| bei Bedarf | Gmail-Zugang neu verbinden, wenn Google ihn widerruft (Passwortänderung, Sicherheitsprüfung) | Abschnitt 7 |

**Regeln bei Änderungen (Deployment):**

1. Vorher `npm run backup`.
2. Prüfungen: `npm run lint && npm run typecheck && npm run test:unit && npm run test:db`.
3. Code holen und bauen: `git pull && npm ci && npm run build`.
4. Neue Migrationen anwenden: `supabase migration up` (nie `supabase db reset`), danach `npm run db:types`.
5. Geänderte n8n-Workflows aus `n8n/workflows/` importieren.
6. App neu starten: `launchctl kickstart -k gui/$(id -u)/online.rheinwerk.web`.
7. Rückweg: vorherigen Commit auschecken und neu bauen; bei Datenproblemen Sicherung aus Schritt 1 nach 4.5.

## 7. Notfallanleitungen

| Notfall | Erkennen | Sofortmaßnahme | Danach |
| --- | --- | --- | --- |
| **Gmail-Zugang abgelaufen** (geschehen am 19.10.2026: Versand fiel aus, Eingangsbestätigungen blieben liegen) | Dashboard-Hinweis „E-Mail-Versand hängt“; Logs „needs to be reconnected“ | n8n über `https://n8n.rheinwerk-service.online` öffnen → Credentials → „RheinWerk Gmail“ → *Reconnect* | wartende E-Mails gehen innerhalb einer Minute automatisch raus; Google-Cloud-Projekt muss auf *In production* stehen (sonst Ablauf nach 7 Tagen) |
| **Website nicht erreichbar** | Uptime-Monitor | Rechner wach? `docker ps` (cloudflared läuft?), `curl localhost:3000` | ggf. `launchctl kickstart -k gui/$(id -u)/online.rheinwerk.web` |
| **Datenbank versehentlich zurückgesetzt** (`supabase db reset`) oder beschädigt | Dashboard leer, Anmeldung scheitert | App und n8n anhalten | Wiederherstellung 4.5 aus der letzten Sicherung |
| **Rechner defekt oder gestohlen** | – | Domain zeigt Fehlerseite von Cloudflare | Abschnitt 4.5 „Kompletter Verlust“ auf neuem Rechner oder direkt Stufe 2 |
| **n8n-Credentials unbrauchbar** („could not decrypt“) | n8n-Fehler in allen Workflows | `~/n8n/data/config` aus der Sicherung zurückkopieren | Schlüssel nie neu erzeugen, solange alte Credentials gebraucht werden |
| **KI-Analyse fällt aus** (OpenAI-Guthaben, Schlüssel) | Erstbearbeitungen bleiben „neu“ | Schlüssel/Guthaben prüfen | Zeitplan holt offene Analysen nach; bis dahin bearbeiten Dispatcher manuell |
| **n8n führt nichts mehr aus** (Logs `LockAcquireTimeoutError … SqliteWriteConnectionMutex`; geschehen am 20.10.2026 nach Zugriff auf die Live-Datenbank vom Rechner aus) | Dashboard-Hinweis „E-Mail-Versand hängt“, n8n-Executions ohne neue Läufe | `docker restart n8n`, danach `pragma integrity_check` auf einer Kopie | wartende E-Mails gehen danach automatisch raus; nie mit Werkzeugen des Rechners auf `~/n8n/data/database.sqlite` zugreifen, solange n8n läuft |
| **Festplatte voll** | Docker-Fehler, Sicherung scheitert | `docker image prune`, alte Sicherungen auslagern | `BACKUP_KEEP` anpassen |
| **Verdacht auf kompromittierten Schlüssel** | – | betroffenen Schlüssel beim Anbieter bzw. mit dem Bootstrap-Skript erneuern (Agent-Secret, Cloudflare-Service-Token, OpenAI, ElevenLabs, Google-OAuth-Client); die Supabase-Schlüssel sind in Stufe 1 nur im eigenen Rechner nutzbar, weil Supabase nicht veröffentlicht ist (in Stufe 2 im Supabase-Projekt rotieren) | Zugriffe in Cloudflare Access und n8n-Executions prüfen |

## 8. Zuständigkeit und Zugänge

Betreiber in Stufe 1 ist eine Person (Projektinhaber). Benötigte Konten, deren Zugangsdaten im Passwort-Manager liegen (nicht im Repository):

| Konto | Wofür |
| --- | --- |
| GitHub `FuzzCube/RhenWerk-WebSite` | Quellcode, Workflow-Exporte, Dokumentation |
| Cloudflare | Domain, DNS, Tunnel-Token, Access, Turnstile |
| Google Cloud + Gmail `rheinwerk.industrieservice@gmail.com` | Postfach, OAuth-Client für n8n |
| OpenAI | KI-Analyse (Abrechnung nach Verbrauch) |
| ElevenLabs | Telefonassistentin, Guthaben |
| Vercel | Blob-Speicher für Formular-Uploads |
| Passwort-Manager | `BACKUP_PASSPHRASE`, n8n-Besitzerkonto, Demo-Passwort |
