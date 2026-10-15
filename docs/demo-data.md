# Demodaten

Alle Personen, Firmen und Adressen sind fiktiv. E-Mail-Adressen verwenden die reservierte Domain `example.com`. Es werden keine echten E-Mails oder Einladungen versendet.

## Demo-Nutzer (task-3-1)

```bash
supabase start                 # lokaler Stack
# .env.local: DEMO_USER_PASSWORD=<mindestens 12 Zeichen>
npm run demo:users
```

| Rolle | Name | E-Mail |
| --- | --- | --- |
| Admin | Clara Becker | `admin.demo@example.com` |
| Manager | Jonas Hoffmann | `manager.demo@example.com` |
| Dispatcher | Lea Schneider | `dispo1.demo@example.com` |
| Dispatcher | Murat Yılmaz | `dispo2.demo@example.com` |
| Dispatcher | Sophie Wagner | `dispo3.demo@example.com` |
| Techniker | Tobias Krüger | `technik1.demo@example.com` |
| Techniker | Anna Lehmann | `technik2.demo@example.com` |
| Techniker | Dariusz Nowak | `technik3.demo@example.com` |

Alle melden sich mit dem Passwort aus `DEMO_USER_PASSWORD` an. Die Liste liegt in `scripts/demo/staff.mjs` und wird auch vom Daten-Seed verwendet.

### Verhalten von `scripts/bootstrap-demo-users.mjs`

- Legt Nutzer ausschließlich über die Auth-Admin-API an (`auth.admin.createUser`/`updateUserById`), keine SQL-Inserts in `auth`-Tabellen.
- `email_confirm: true` bestätigt die Adresse direkt; es wird **keine** Einladungs- oder Bestätigungs-E-Mail verschickt (geprüft: Mailpit bleibt leer).
- Das Passwort kommt nur aus `DEMO_USER_PASSWORD` (`.env.local`, von Git ignoriert); im Repository steht nur der leere Variablenname in `.env.example`.
- **Idempotent:** Ein erneuter Lauf aktualisiert Passwort, Anzeigenamen und Profil der vorhandenen Demo-Nutzer und erzeugt keine Duplikate.
- **Seed-Eigentum:** Demo-Nutzer tragen `app_metadata.demo_seed = "rheinwerk-demo-v1"`. `app_metadata` ist nur mit dem Secret Key änderbar und wird nicht für Berechtigungen verwendet; Rolle und Aktivstatus stehen in `profiles`. Existiert eine Adresse bereits **ohne** diese Kennzeichnung (echter Nutzer), wird sie nicht verändert und das Skript endet mit Exit-Code 1.
- Läuft nur gegen `127.0.0.1`/`localhost`; für ein Remote-Projekt muss `DEMO_BOOTSTRAP_ALLOW_REMOTE=1` gesetzt werden. Für Demodaten wird eine isolierte Umgebung empfohlen.



## Daten-Seed (task-3-2)

```bash
npm run demo:users            # einmalig: Demo-Nutzer
npm run demo:seed             # Demodaten ersetzen (idempotent)
npm run demo:verify           # Konsistenzprüfungen, jede Zeile muss "ok" zeigen
npm run demo:seed -- --purge  # nur Demodaten entfernen
```

Optional `DEMO_SEED_ANCHOR=JJJJ-MM-TT` (Standard: heute, Europe/Berlin). Der Seed läuft wie der Nutzer-Bootstrap nur lokal, außer `DEMO_BOOTSTRAP_ALLOW_REMOTE=1` ist gesetzt.

### Umfang

- Rund 600 Anfragen über 24 Kalendermonate einschließlich des laufenden Monats, saisonal (Wartung im Frühjahr und Herbst, Lüftung im Sommer, Kompressoren im Winter) mit leichtem Wachstum.
- Alle drei Leistungsarten, vier Anlagenarten, alle Prioritäten und jeder Status von Erstbearbeitung, Arbeit, Einsatz, Rechnung und Nachricht.
- Vollständige Chronologie: Eingang → Eingangsbestätigung → Analyse/Prüfung/Rückfrage → Zuweisung → Einsätze → Arbeitspositionen → Abschluss → Rechnung → Versand → Zahlung, jeweils mit Audit-Ereignissen und Automatisierungsläufen.
- Arbeitszeiten Mo–Fr 07:00–16:00 für alle Techniker, eine Abwesenheit in der laufenden Woche sowie historische Abwesenheiten. Alle Einsätze liegen in der Arbeitszeit, außerhalb von Abwesenheiten und überschneidungsfrei.
- Tarifwechsel vor 180 Tagen: alte Tarife (`DEMO-…-2024`, inaktiv) und neue Tarife (`DEMO-…`). Ausgestellte Rechnungen behalten die alten Preise.
- Eine unzugeordnete eingehende E-Mail im Posteingang von Dispatcherin 1.
- Kunden und Standorte in der Region um Mannheim (Rhein-Neckar), passend zur Website und zum Einsatzgebiet des Telefonassistenten (task-13-9; Postleitzahlen aus `docs/telefonassistent/einsatzgebiet.json`, Vorwahl passend zum Ort).
- 14 feste SLA-Verträge (`service_contracts`, `is_demo`) mit festen Kunden: 8 mit 24/7, 4 ohne, einer abgelaufen, einer noch nicht gültig, einer mit zwei Standorten. Sie ändern sich bei keinem Seed; Liste und Testfälle in `docs/telefonassistent/testdaten.md`. Ihre Anfragen tragen die Vertragsnummer; Kunden mit 24/7 geben das Notfall-SLA häufiger an.
- Einsätze echter (nicht Demo-)Anfragen blockieren den Demo-Kalender, damit Demo- und Live-Einsätze sich nie überschneiden.
- Kein Seed-Datensatz löst einen echten Versand aus; Rechnungen tragen „Musterrechnung / Demodaten“.

### Funktionsweise

`scripts/demo/generate.mjs` simuliert jede Anfrage entlang ihres Lebenszyklus. Jeder Schritt hat einen Zeitpunkt; Schritte nach dem Stichzeitpunkt (jetzt) werden nicht ausgeführt. Dadurch passt der Endstatus immer zur Chronologie, und es gibt keine Ist-Daten in der Zukunft. Nur geplante Einsätze dürfen in der Zukunft liegen. Der Zufallsgenerator ist deterministisch (Anker), ein erneuter Lauf am selben Tag erzeugt dieselben Daten.

`public.demo_seed_apply(payload)` (nur `service_role`) entfernt in **einer Transaktion** die bisherigen Demodaten und fügt die neuen in zeitlicher Reihenfolge ein. Anfrage- und Rechnungsnummern vergibt weiterhin die Datenbank. Alle Constraints und Trigger gelten auch für den Seed.

### Seed-Eigentum und Bereinigung

| Daten | Kennzeichnung |
| --- | --- |
| Anfragen und alle Kinddaten (Ereignisse, Nachrichten, Läufe, Einsätze, Positionen, Rechnungen) | `requests.is_demo = true` |
| Tarife, Arbeitszeiten, Abwesenheiten, unzugeordnete E-Mails | `private.demo_seed_records` |
| Einstellungen | nur befüllt, wenn unverändert (`company_details = {}`, `updated_by` leer); Originalwerte in `private.demo_seed_records`, beim Bereinigen wiederhergestellt. Verkäuferdaten wie auf der Website (Mannheim, Geschäftsführung, Fiktiv-Hinweis), Zahlungsdaten als „(Demo)“ gekennzeichnet |
| SLA-Verträge | `service_contracts.is_demo = true`, vom Seed-Skript nach `demo_seed_apply` ersetzt, bei `--purge` entfernt |
| Demo-Nutzer | `app_metadata.demo_seed` (werden vom Seed nicht gelöscht) |
| Konten automatischer Tests | Adresse `api-…`, `ui-…` oder `e2e-…@example.com` ohne `demo_seed` (`scripts/demo/test-accounts.mjs`). Der Seed löscht sie nach den Testanfragen (Arbeitszeiten, Profil, Auth-Konto); ist ein Konto noch referenziert, wird es deaktiviert und gesperrt. Andere Konten werden nie angefasst |

`public.demo_seed_purge()` entfernt nur diese Daten (Testkonten räumt das Skript `demo:seed` bzw. `demo:seed -- --purge` danach über die Auth-Admin-API auf). Append-only-Ereignisse und ausgestellte Rechnungen bleiben geschützt; nur während der Bereinigung erlaubt ein transaktionslokales Flag das Löschen von Zeilen **demo-gekennzeichneter** Anfragen. Danach setzen sich die Nummernzähler auf die höchste verbliebene Nummer, sodass ein erneuter Seed dieselben Nummern erhält. Geprüft: Eine Live-Anfrage mit Ereignis und ein Live-Tarif bleiben bei Seed und Bereinigung unverändert.

### Fallbeispiele

Jedes Fallbeispiel ist über `raw_payload.demo_case` auffindbar.

| Fallbeispiel | Zustand |
| --- | --- |
| Sichere automatische Bearbeitung | automatisch bearbeitet, abgeschlossen, bezahlt |
| Rückfrage und Kundenantwort | Rückfrage, Antwort, Neuanalyse, automatisch bearbeitet |
| Geringe Konfidenz mit menschlicher Freigabe | `needs_review` → Freigabe durch Dispatcher (`human_review`) |
| Korrigierter Modellfehler | automatisch, später Priorität korrigiert (`automatic_result_corrected`, Lauf markiert) |
| Technischer Fehler der Analyse | Lauf `failed` (`MODEL_TIMEOUT`), danach manuell bearbeitet |
| Ablehnung | abgelehnt mit Grund (`human_review`) |
| Stornierung nach Planung / vor Abschluss der Erstbearbeitung | storniert mit Grund; Einsatz storniert bzw. ohne Erstabschluss |
| Versäumte vereinbarte Frist | Antwortfrist überschritten; Servicefrist nach Ablauf verschoben (`breach_recorded = true`) |
| Keine Fristzusage | ohne vereinbarte Fristen |
| Bestellte Teile und Folgeeinsatz | Teil bestellt, Warten auf Teile, Folgeeinsatz, Teil verbraucht |
| Abgeschlossen mit offener Rechnung | Rechnung versendet, nicht bezahlt |
| Mehrere Läufe und Nachrichten, ein Abschluss | zwei Rückfragen (eine fehlgeschlagen), drei Läufe, ein `intake_completed` |
| Warten auf Ersatzteil (offen) | Einsatz und Anfrage `waiting_parts` |
| Rechnungsentwurf / Rechnung ausgestellt, Versand ausstehend | `draft` bzw. `issued` |
| Kundenantwort erhalten | Antwort eingegangen, erneute Prüfung erforderlich |
| Prüfung offen (mit E-Mail-Entwurf) | `needs_review`, Entwurf im Status `draft` |
| Warten auf Kundenantwort | `awaiting_customer` |
| Neu und noch nicht zugewiesen / Analyse läuft | `new` ohne Dispatcher / `analyzing` mit laufendem Lauf |
| Bearbeitet, Planung ausstehend | `processed`, `not_planned` |
| Einsatz dieser Woche (1–3) | je Techniker ein Einsatz in der laufenden Woche |
| Einsatz läuft | Einsatz `in_progress` |


## Demo-Dateien (task-3-3)

Dateien unter `scripts/demo/files/`: die PDFs selbst erzeugt (fiktive Inhalte mit „DEMO – keine echten Daten“), die drei Fotos KI-generiert vom Nutzer bereitgestellt (ohne Personen, echte Marken oder Kennzeichen; Typenschild mit fiktivem Hersteller). Der Seed lädt sie in den privaten Bucket `dashboard` unter `demo/<request_id>/` und legt passende `attachments`-Zeilen an:

| Datei | Fallbeispiel | Eltern | Sichtbarkeit |
| --- | --- | --- | --- |
| `foto-gleitringdichtung.jpg` | Bestellte Teile und Folgeeinsatz | Einsatz | operational |
| `wartungsprotokoll-kompressor.pdf` | Sichere automatische Bearbeitung | Einsatz | operational |
| `pruefbericht-pumpe.pdf` | Technischer Fehler der Analyse | Einsatz | operational |
| `typenschild-pumpe.jpg` | Rückfrage und Kundenantwort | Kundenantwort (E-Mail) | dispatch |
| `interne-notiz-forderung.pdf` | Abgeschlossen mit offener Rechnung | Rechnung | management |
| `foto-lueftungsanlage.jpg` | Prüfung offen mit E-Mail-Entwurf | Anfrage | operational |

Geprüft per Download mit echten Demo-Logins: `anon`, fremde Techniker und fremde Dispatcher erhalten keine Datei; Techniker erhalten nur operative Dateien ihrer Anfrage, nicht den Anhang der Kunden-E-Mail; Dispatcher erhalten Dateien ihrer Anfragen außer der Management-Notiz; der Manager erhält alle.

Die Dateien können durch eigene Bilder oder PDFs mit **gleichem Basisnamen** ersetzt werden; der Seed sucht `<name>.pdf|jpg|jpeg|png` und setzt den MIME-Typ nach der Endung (max. 10 MB, keine echten Personen, Firmen oder Kennzeichen). Danach `npm run demo:seed` ausführen. Bereinigung (`--purge`, erneuter Seed) entfernt nur Objekte unter `demo/`.

## Prüf-Fixture Zeitersparnis (task-3-3)

`supabase/tests/database/savings_fixture.test.sql` legt **nur innerhalb der Testtransaktion** 100 automatische Erstabschlüsse mit dem Demo-Basiswert von 15 Minuten an und prüft:

- 100 berechtigte Anfragen, 1.500 Minuten, **25 h** (Anzeige „25 h 0 min“),
- nicht mitgezählt: menschliche Prüfung, manuelle Bearbeitung, korrigierte automatische Ergebnisse, Abschlüsse außerhalb des Zeitraums, offene Anfragen,
- mehrere Läufe und Nachrichten einer Anfrage ergeben einen Abschluss.

Die Fixture wird zurückgerollt und ist nie Teil der Demodaten; ihr Ergebnis ist **nicht** die Gesamtersparnis des Seeds. Formel: `sum(manual_minutes_baseline) / 60` über automatische Erstabschlüsse ohne erfasste Korrektur. Der Basiswert beträgt auf Nutzerwunsch 15 statt 5 Minuten (siehe `docs/decisions.md`).

### Zurücksetzen

`supabase db reset` entfernt lokal alle Daten einschließlich der Demo-Nutzer; danach `npm run demo:users` und `npm run demo:seed` erneut ausführen.
