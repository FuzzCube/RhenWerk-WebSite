import type { Metadata } from "next";
import { BackupButton } from "@/components/dashboard/backup-button";
import { ImageUpdateButton } from "@/components/dashboard/image-update-button";
import { ResolveAlertButton } from "@/components/dashboard/resolve-alert-button";
import { RestoreButton, RestoreProgress } from "@/components/dashboard/restore-button";
import { SystemCheckButton } from "@/components/dashboard/system-check-button";
import { Card } from "@/components/dashboard/ui/card";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { StatusChip } from "@/components/dashboard/ui/status-chip";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import {
  backupContents, backupReasonLabel, backupStatus, formatBytes, imageChanges, imageUpdateActive, imageUpdateStatus, latestVerified, providerView,
  restorable, restoreActive, restoreStatus, type BackupRow, type ImageUpdateRow,
} from "@/lib/backups";
import { loadSystemOverview } from "@/lib/dashboard/system";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import {
  MONITORED_SYSTEMS, checkRequestState, creditView, isStale, monitorNotes, monitorStatus, versionStatus, type Credit, type MonitorEntry, type OpenAIEntry, type VersionRow,
} from "@/lib/system-monitoring";
import { alertSourceLabel, resolvedLabel, severityStatus, systemSummary, type SystemAlertRow } from "@/lib/system-summary";

export const metadata: Metadata = { title: "System" };

// Area "System" for the owner (task-17-12): is the data safe, does everything run, is anything to update or top up?
// Admin and manager read the same content. Code updates are not part of the dashboard (task-17-12;
// since task-17-17 the code runs only from the development folder). The watchdog fills the state of every system
// (n8n task-17-8, phone assistant and credit task-17-9, the others task-17-15), the nightly run the versions (only
// shown, never installed); only admin starts a check at once ("System prüfen"). Backups (task-18-6): the newest checked
// one, the backup of the provider and the list of 14 days; only admin starts one at once ("Jetzt sichern"). Open and
// resolved warnings are listed at the end; only admin closes one (task-17-10). Restore (task-18-7): only admin, from a
// row of the list; the newest restore with its result in the card "Datensicherung". System updates of the images on the
// VPS (task-18-8): "Update einspielen" (only admin) when the repository has newer images, the last five runs below.
export default async function SystemPage() {
  const employee = await requireRole(rolesFor("/dashboard/system"));
  const isAdmin = employee.role === "admin";
  const system = await loadSystemOverview();
  const summary = systemSummary(system.alerts);
  const critical = summary.alerts.some((alert) => alert.severity === "critical");
  const versions = system.dependencies.versions ?? [];
  const mira = system.monitoring.mira;
  const now = new Date();
  const checkState = checkRequestState(system.checkRequest, now);
  const backupState = checkRequestState(system.backupRequest, now, 30);
  const latest = latestVerified(system.backups);
  const provider = providerView(system.provider);
  const openAlerts = summary.alerts as SystemAlertRow[];
  const restoring = restoreActive(system.restore, now);
  const updating = imageUpdateActive(system.imageUpdates[0], now);
  const serverImages = versions.find((row) => row.key === "server_images");
  const backupColumns = backupColumnsFor(isAdmin ? { migration: system.migration, now, restoring } : null);

  const alertColumn: Column<SystemAlertRow> = {
    key: "alert", header: "Warnung", mobile: "title",
    cell: (row) => (
      <>
        <span className="system-alert-title"><StatusChip status={severityStatus(row)} /> {row.title}</span>
        {row.detail && (
          <details className="system-details system-details--inline">
            <summary>Einzelheiten</summary>
            <p className="system-alert-detail">{row.detail}</p>
          </details>
        )}
      </>
    ),
  };
  const sourceColumn: Column<SystemAlertRow> = { key: "source", header: "Quelle", cell: (row) => alertSourceLabel(row.source) };
  const sinceColumn: Column<SystemAlertRow> = {
    key: "since", header: "Seit",
    cell: (row) => <><span className="mono">{formatDateTime(row.first_seen_at)}</span>{row.occurrences > 1 && <span className="cell-sub">{row.occurrences}-mal</span>}</>,
  };
  const openColumns: Column<SystemAlertRow>[] = [
    alertColumn, sourceColumn, sinceColumn,
    { key: "seen", header: "Zuletzt gesehen", cell: (row) => <span className="mono">{formatDateTime(row.last_seen_at)}</span>, mobile: "hide" },
    ...(isAdmin ? [{ key: "action", header: "Aktion", cell: (row: SystemAlertRow) => <ResolveAlertButton alertId={row.id} title={row.title} /> }] : []),
  ];
  const resolvedColumns: Column<SystemAlertRow>[] = [
    alertColumn, sourceColumn, sinceColumn,
    { key: "resolved", header: "Behoben", cell: (row) => <><span className="mono">{formatDateTime(row.resolved_at)}</span><span className="cell-sub">{resolvedLabel(row)}</span></> },
  ];

  return (
    <div className="dash-page rw-page rw-page--tight system-page">
      <header className="dash-page-header">
        <div>
          <h1>System</h1>
          <p>Datensicherung, Zustand der Systeme und verfügbare Updates auf einen Blick.</p>
        </div>
        {isAdmin && !system.error && <div className="dash-page-header__actions"><SystemCheckButton state={checkState} /></div>}
      </header>

      {system.error ? (
        <ErrorState>
          <p>Bitte die Seite neu laden.</p>
          {/* During a restore the database is away for a moment: reload by itself until it answers again */}
          {isAdmin && <RestoreProgress active />}
        </ErrorState>
      ) : (
        <>
          <section className={`rw-banner ${summary.ok ? "rw-banner--good" : critical ? "rw-banner--danger" : "rw-banner--info"} system-summary`} aria-labelledby="system-zusammenfassung">
            <Icon name={summary.ok ? "check-circle" : "alert"} size={20} />
            <div>
              <h2 id="system-zusammenfassung" className="system-summary__title">{summary.title}</h2>
              {summary.ok ? (
                <p>Keine offenen Warnungen.</p>
              ) : (
                <ul className="system-alerts">
                  {summary.alerts.map((alert) => (
                    <li key={alert.id}>
                      <strong>{alert.title}</strong>
                      <span className="cell-sub">{alertSourceLabel(alert.source)} · seit <span className="mono">{formatDateTime(alert.first_seen_at)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              {!summary.ok && <a className="system-summary__link" href="#system-warnungen">Zur Liste der Warnungen</a>}
            </div>
          </section>

          <div className="system-grid">
            <Card stripe="neutral" title="Datensicherung" id="system-sicherung" headingLevel={2}
              description="Jeden Tag um 03:00 werden Anfragen, Kunden, Rechnungen, Dateien und die Automatisierung verschlüsselt gesichert und mit einer Probewiederherstellung geprüft; aufbewahrt 14 Tage auf dem Server.">
              <div className="system-backup">
                {latest ? (
                  <div className="system-backup__latest">
                    <p><StatusChip status={backupStatus(latest)} /> Letzte geprüfte Sicherung <strong className="mono">{formatDateTime(latest.finished_at)}</strong> · {formatBytes(latest.size_bytes)}</p>
                    <ul className="system-backup__contents">
                      {backupContents(latest.contents).filter((item) => item.label !== "Commit").map((item) => <li key={item.label}><span>{item.label}</span><span className="mono">{item.value}</span></li>)}
                    </ul>
                  </div>
                ) : (
                  <EmptyState title="Noch keine geprüfte Sicherung." />
                )}
                <p className="system-backup__provider"><StatusChip status={provider.status} /> Sicherung des Anbieters: {provider.text}</p>
                {system.restore && (
                  <div className="system-backup__restore">
                    <p>
                      <StatusChip status={restoreStatus(system.restore, now)} /> Letzte Wiederherstellung: Sicherung vom <span className="mono">{formatDateTime(system.restore.backup_finished_at)}</span>
                      <span className="cell-sub">angefordert <span className="mono">{formatDateTime(system.restore.requested_at)}</span>{system.restore.requester && <> von {system.restore.requester}</>}</span>
                    </p>
                    {restoring && <p className="cell-sub">Website, Dashboard und Automatisierung sind dabei einige Minuten nicht erreichbar. Die Seite lädt sich selbst neu.</p>}
                    {system.restore.pre_backup_file && <p className="cell-sub">Stand davor gesichert: <span className="mono">{system.restore.pre_backup_file}</span></p>}
                    {system.restore.error && (
                      <details className="system-details system-details--inline">
                        <summary>Fehler</summary>
                        <p className="system-alert-detail">{system.restore.error}</p>
                      </details>
                    )}
                    <RestoreProgress active={restoring} />
                  </div>
                )}
                {isAdmin && <BackupButton state={backupState} />}
              </div>
            </Card>

            <Card stripe="neutral" title="Zustand der Systeme" id="system-zustand" headingLevel={2}
              description="Website, Datenbank, Automatisierung (n8n), Telefonassistent, E-Mail-Versand, Docker und Speicherplatz.">
              <ul className="system-monitors">
                {MONITORED_SYSTEMS.map((item) => <MonitorRow key={item.key} label={item.label} entry={system.monitoring[item.key]} now={now} />)}
              </ul>
            </Card>

            <Card stripe="neutral" title="Guthaben externer Dienste" id="system-guthaben" headingLevel={2}
              description="Guthaben des Telefonassistenten (ElevenLabs) und Kosten von OpenAI für die Automatisierung, mit Warnung unter dem Schwellwert.">
              <div className="system-credits">
                {mira?.credit ? (
                  <CreditMeter label="ElevenLabs (Telefonassistent)" credit={mira.credit} />
                ) : (
                  <EmptyState title={mira && mira.state !== "off" ? "Guthaben nicht abrufbar." : "Noch keine Angaben gemeldet."}>
                    {mira?.checks?.find((c) => c.key === "mira:credit" && c.ok === null) && <p>{mira.checks.find((c) => c.key === "mira:credit")!.detail}</p>}
                  </EmptyState>
                )}
                <OpenAIMeter entry={system.monitoring.openai} now={now} />
              </div>
            </Card>

          </div>

          <Card stripe="neutral" title="Sicherungen der letzten 14 Tage" count={system.backups.length} id="system-sicherungen" headingLevel={2} flush
            description={isAdmin
              ? "Täglich, von Hand, vor jeder Datenbankänderung des Deployments und vor einer Wiederherstellung. Wiederherstellen lässt sich jede geprüfte vollständige Sicherung mit dem aktuellen Stand der Datenbank."
              : "Täglich, von Hand, vor jeder Datenbankänderung des Deployments und vor einer Wiederherstellung. Wiederherstellen kann nur die Rolle Admin."}>
            <div className="system-backups">
              <DataTable caption="Sicherungen" columns={backupColumns} rows={system.backups} rowKey={(row) => row.id}
                empty={<EmptyState title="Noch keine Sicherung in den letzten 14 Tagen." />} />
            </div>
          </Card>

          <Card stripe="meta" title="Systemversionen" id="system-versionen" headingLevel={2} flush
            description={`Neue Versionen werden angezeigt, aber nicht installiert. Updates führt der Betreiber nach den Release Notes und mit Sicherung durch.${system.dependencies.checked_at ? ` Geprüft ${formatDateTime(system.dependencies.checked_at)}.` : ""}`}>
            <div className="system-versions">
              <DataTable caption="Systemversionen" columns={versionColumns} rows={versions} rowKey={(row) => row.key}
                empty={<EmptyState title="Noch nicht geprüft. Die Versionen werden jeden Tag um 09:00 ermittelt." />} />
            </div>
            {isAdmin && ((serverImages?.pending ?? 0) > 0 || updating) && (
              <div className="system-image-update-wrap">
                <p className="cell-sub">{updating ? "Das Systemupdate läuft. Die Seite aktualisiert sich selbst." : "Für den Server liegen neue Versionen bereit. Vorher wird alles gesichert; scheitert der Selbsttest, läuft automatisch wieder der Stand von vorher."}</p>
                <ImageUpdateButton changes={serverImages?.items?.map(({ name, current, latest }) => ({ name, current, latest })) ?? []} disabled={updating || restoring} />
              </div>
            )}
            {system.imageUpdates.length > 0 && (
              <>
                <h3 className="system-subheading">Letzte Systemupdates</h3>
                <div className="system-image-updates">
                  <DataTable caption="Letzte Systemupdates" columns={imageUpdateColumns(now)} rows={system.imageUpdates} rowKey={(row) => row.id} empty={null} />
                </div>
                <RestoreProgress active={updating} />
              </>
            )}
          </Card>

          <Card stripe={summary.ok ? "success" : critical ? "danger" : "attention"} title="Warnungen" count={openAlerts.length} id="system-warnungen" headingLevel={2} flush
            description={isAdmin
              ? "Offene Warnungen schließen sich selbst, sobald die nächste Prüfung besteht. „Erledigt“ schließt eine Warnung von Hand; besteht die Ursache fort, öffnet die nächste Prüfung sie neu."
              : "Offene Warnungen schließen sich selbst, sobald die nächste Prüfung besteht. Von Hand erledigen kann nur die Rolle Admin."}>
            <div className="system-alerts-open">
              <DataTable caption="Offene Warnungen" columns={openColumns} rows={openAlerts} rowKey={(row) => row.id}
                empty={<EmptyState title="Keine offenen Warnungen." tone="good" />} />
            </div>
            {/* Resolved warnings only on request: the open ones are what matters day to day */}
            <details className="system-resolved">
              <summary className="system-subheading">Behoben in den letzten 30 Tagen <span className="mono">{formatNumber(system.resolvedAlerts.length)}</span></summary>
              <div className="system-alerts-resolved">
                <DataTable caption="Behobene Warnungen" columns={resolvedColumns} rows={system.resolvedAlerts} rowKey={(row) => row.id}
                  empty={<EmptyState title="Keine behobenen Warnungen." />} />
              </div>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}

// restore: only for admin; the button only on rows that request_restore accepts, disabled while a restore runs
function backupColumnsFor(restore: { migration: string | null; now: Date; restoring: boolean } | null): Column<BackupRow>[] {
  return restore ? [...backupColumns, {
    key: "action", header: "Aktion",
    cell: (row) => restorable(row, restore.migration, restore.now)
      ? <RestoreButton backupId={row.id} finishedAt={row.finished_at} disabled={restore.restoring} />
      : <span className="cell-sub">–</span>,
  }] : backupColumns;
}

const backupColumns: Column<BackupRow>[] = [
  { key: "time", header: "Zeitpunkt", mobile: "title", cell: (row) => <span className="mono">{formatDateTime(row.finished_at)}</span> },
  { key: "reason", header: "Anlass", cell: (row) => <>{backupReasonLabel(row.reason)}{row.requester && <span className="cell-sub">{row.requester}</span>}</> },
  { key: "size", header: "Größe", cell: (row) => <span className="mono">{formatBytes(row.size_bytes)}</span> },
  {
    key: "check", header: "Prüfung",
    cell: (row) => (
      <>
        <StatusChip status={backupStatus(row)} />
        {row.error && (
          <details className="system-details system-details--inline">
            <summary>Fehler</summary>
            <p className="system-alert-detail">{row.error}</p>
          </details>
        )}
      </>
    ),
  },
  {
    key: "contents", header: "Inhalt", mobile: "hide",
    cell: (row) => {
      const items = backupContents(row.contents);
      if (!items.length) return "–";
      return (
        <details className="system-details system-details--inline">
          <summary>{row.file_name ?? "Anzeigen"}</summary>
          <ul className="system-backup__contents">{items.map((item) => <li key={item.label}><span>{item.label}</span><span className="mono">{item.value}</span></li>)}</ul>
        </details>
      );
    },
  },
];

function imageUpdateColumns(now: Date): Column<ImageUpdateRow>[] {
  return [
    { key: "time", header: "Zeitpunkt", mobile: "title", cell: (row) => <><span className="mono">{formatDateTime(row.requested_at)}</span>{row.requester && <span className="cell-sub">{row.requester}</span>}</> },
    { key: "changes", header: "Versionen", cell: (row) => <span className="mono">{imageChanges(row)}</span> },
    {
      key: "result", header: "Ergebnis",
      cell: (row) => (
        <>
          <StatusChip status={imageUpdateStatus(row, now)} />
          {row.error && (
            <details className="system-details system-details--inline">
              <summary>Fehler</summary>
              <p className="system-alert-detail">{row.error}</p>
            </details>
          )}
        </>
      ),
    },
  ];
}

const versionColumns: Column<VersionRow>[] = [
  { key: "system", header: "System", mobile: "title", cell: (row) => <strong>{row.label}</strong> },
  { key: "current", header: "Installiert", cell: (row) => <span className="mono">{row.current ?? "–"}</span> },
  { key: "latest", header: "Verfügbar", cell: (row) => <span className="mono">{row.latest ?? "–"}</span> },
  {
    key: "advice", header: "Empfehlung",
    cell: (row) => (
      <>
        <StatusChip status={versionStatus(row.level)} />
        {row.text !== versionStatus(row.level).label && <span className="cell-sub">{row.text}</span>}
        {row.hint && <span className="cell-sub">{row.hint}</span>}
        {(row.level === "update" || row.level === "major") && (
          <details className="system-details system-details--inline">
            <summary>{row.items && row.items.length > 0 ? `${row.items.length} anzeigen` : "Vorgehen"}</summary>
            {row.how && <p className="system-alert-detail">{row.how}</p>}
            {row.items && row.items.length > 0 && (
              <ul className="system-packages">
                {row.items.map((item) => (
                  <li key={item.name}>
                    {item.notes ? <a href={item.notes} target="_blank" rel="noreferrer" className="mono">{item.name}</a> : <span className="mono">{item.name}</span>}
                    <span className="mono">{item.current} → {item.latest}{item.level === "major" ? " (Hauptversion)" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </>
    ),
  },
  { key: "notes", header: "Release Notes", cell: (row) => <a href={row.notes} target="_blank" rel="noreferrer">Release Notes</a> },
];

function MonitorRow({ label, entry, now }: { label: string; entry: MonitorEntry | undefined; now: Date }) {
  if (!entry) {
    return (
      <li>
        <div className="system-monitors__head">
          <strong>{label}</strong>
          <StatusChip status={{ key: "nicht-geprueft", label: "Noch nicht geprüft", tone: "closed" }} />
        </div>
      </li>
    );
  }
  const notes = monitorNotes(entry);
  return (
    <li>
      <div className="system-monitors__head">
        <strong>{label}</strong>
        <StatusChip status={monitorStatus(entry, now)} />
      </div>
      <span className="cell-sub">{entry.summary ? <>{entry.summary} · </> : null}Geprüft <span className="mono">{formatDateTime(entry.checked_at)}</span></span>
      {notes.length > 0 && (
        <ul className="system-monitors__notes">
          {notes.map((note) => <li key={note.text} className={note.tone === "bad" ? "system-monitors__note--bad" : "cell-sub"}>{note.text}</li>)}
        </ul>
      )}
    </li>
  );
}

const usd = (value: number) => value.toLocaleString("de-DE", { style: "currency", currency: "USD" });

// Costs of OpenAI (task-19-5): spend of the month, with a budget also what is left of it
function OpenAIMeter({ entry, now }: { entry: OpenAIEntry | undefined; now: Date }) {
  const label = "OpenAI (Automatisierung n8n)";
  if (!entry || entry.state === "off") {
    return (
      <div className="system-credit">
        <div className="system-monitors__head"><strong>{label}</strong><StatusChip status={{ key: "nicht-eingerichtet", label: "Nicht eingerichtet", tone: "closed" }} /></div>
        <span className="cell-sub">Für die Anzeige einen Admin-Key der OpenAI-Organisation (Leserecht für Kosten) als OPENAI_ADMIN_KEY und das Guthaben als OPENAI_BUDGET_USD beim Wächter eintragen (docs/betrieb.md).</span>
      </div>
    );
  }
  const costs = entry.costs;
  const stale = isStale(entry, now);
  const share = costs?.budget ? Math.min(1, Math.max(0, (costs.remaining ?? 0) / costs.budget)) : null;
  const low = entry.state === "warning" || entry.state === "critical";
  return (
    <div className="system-credit">
      <div className="system-monitors__head">
        <strong>{label}</strong>
        {stale ? <StatusChip status={{ key: "veraltet", label: "Prüfung veraltet", tone: "wait" }} />
          : entry.state === "critical" ? <StatusChip status={{ key: "aufgebraucht", label: "Budget aufgebraucht", tone: "act" }} />
          : low && costs ? <StatusChip status={{ key: "niedrig", label: "Niedrig", tone: "wait" }} /> : null}
      </div>
      {costs ? (
        <>
          <p>
            {costs.budget !== null && costs.remaining !== null
              ? <><span className="mono">{usd(costs.remaining)}</span> von <span className="mono">{usd(costs.budget)}</span> übrig</>
              : <><span className="mono">{usd(costs.spent)}</span> verbraucht</>}
          </p>
          {share !== null && (
            <span className={`rw-bars__track${low ? " rw-bars__track--warn" : ""}`} role="img" aria-label={`${Math.round(share * 100)} % übrig`}>
              <span style={{ width: `${share * 100}%` }} />
            </span>
          )}
          <span className="cell-sub">
            Verbrauch {costs.month.slice(5, 7)}/{costs.month.slice(0, 4)}: <span className="mono">{usd(costs.spent)}</span>
            {costs.min !== null && <> · Warnung unter <span className="mono">{usd(costs.min)}</span></>} · geprüft <span className="mono">{formatDateTime(entry.checked_at)}</span>
          </span>
        </>
      ) : (
        <span className="system-monitors__note--bad">{entry.detail}</span>
      )}
    </div>
  );
}

function CreditMeter({ label, credit }: { label: string; credit: Credit }) {
  const view = creditView(credit);
  return (
    <div className="system-credit">
      <div className="system-monitors__head">
        <strong>{label}</strong>
        {view.low && <StatusChip status={view.empty ? { key: "aufgebraucht", label: "Aufgebraucht", tone: "act" } : { key: "niedrig", label: "Niedrig", tone: "wait" }} />}
      </div>
      <p><span className="mono">{formatNumber(credit.remaining)}</span> von <span className="mono">{formatNumber(credit.limit)}</span> Credits übrig</p>
      <span className={`rw-bars__track${view.low ? " rw-bars__track--warn" : ""}`} role="img" aria-label={`${Math.round(view.share * 100)} % übrig`}>
        <span style={{ width: `${view.share * 100}%` }} />
      </span>
      <span className="cell-sub">
        Tarif {credit.tier} · Warnung unter <span className="mono">{formatNumber(credit.min)}</span>
        {credit.reset_at && <> · neues Kontingent ab <span className="mono">{formatDate(credit.reset_at)}</span></>}
      </span>
    </div>
  );
}
