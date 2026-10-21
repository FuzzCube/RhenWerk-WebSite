import type { Metadata } from "next";
import { Card } from "@/components/dashboard/ui/card";
import { StatusChip } from "@/components/dashboard/ui/status-chip";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadSystemOverview } from "@/lib/dashboard/system";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { creditView, monitorNotes, monitorStatus, type Credit, type MonitorEntry } from "@/lib/system-monitoring";
import { alertSourceLabel, systemSummary } from "@/lib/system-summary";

export const metadata: Metadata = { title: "System" };

// Area "System" for the owner (task-17-12): is the data safe, does everything run, is anything to update or top up?
// Admin and manager read the same content. Code updates are not part of the dashboard (nightly run and terminal,
// docs/betrieb.md 6). The watchdog fills state and credit of the phone assistant (task-17-9); backups (task-17-13)
// and the other systems (task-17-15) still show an empty state.
export default async function SystemPage() {
  await requireRole(rolesFor("/dashboard/system"));
  const system = await loadSystemOverview();
  const summary = systemSummary(system.alerts);
  const critical = summary.alerts.some((alert) => alert.severity === "critical");
  const npm = system.dependencies.npm;
  const n8n = system.dependencies.n8n;
  const mira = system.monitoring.mira;
  const now = new Date();

  return (
    <div className="dash-page rw-page rw-page--tight system-page">
      <header className="dash-page-header">
        <div>
          <h1>System</h1>
          <p>Datensicherung, Zustand der Systeme und verfügbare Updates auf einen Blick.</p>
        </div>
      </header>

      {system.error ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
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
            </div>
          </section>

          <div className="system-grid">
            <Card stripe="neutral" title="Datensicherung" id="system-sicherung" headingLevel={2}
              description="Jede Nacht um 02:00 werden Anfragen, Kunden, Rechnungen, Dateien und die Automatisierung gesichert und mit einer Probewiederherstellung geprüft.">
              <EmptyState title="Die Liste der Sicherungen erscheint hier in Kürze." />
            </Card>

            <Card stripe="neutral" title="Zustand der Systeme" id="system-zustand" headingLevel={2}
              description="Website, Datenbank, Automatisierung (n8n), Telefonassistent, E-Mail-Versand, Docker und Speicherplatz.">
              {mira ? (
                <ul className="system-monitors">
                  <MonitorRow label="Telefonassistent (Mira)" entry={mira} now={now} />
                </ul>
              ) : (
                <EmptyState title="Noch keine Prüfung gemeldet." />
              )}
            </Card>

            <Card stripe="neutral" title="Guthaben externer Dienste" id="system-guthaben" headingLevel={2}
              description="Guthaben des Telefonassistenten (ElevenLabs) mit Warnung unter dem Schwellwert.">
              {mira?.credit ? (
                <CreditMeter label="ElevenLabs (Telefonassistent)" credit={mira.credit} />
              ) : (
                <EmptyState title={mira && mira.state !== "off" ? "Guthaben nicht abrufbar." : "Noch keine Angaben gemeldet."}>
                  {mira?.checks?.find((c) => c.key === "mira:credit" && c.ok === null) && <p>{mira.checks.find((c) => c.key === "mira:credit")!.detail}</p>}
                </EmptyState>
              )}
            </Card>

            <Card stripe="meta" title="Systemversionen" id="system-versionen" headingLevel={2}
              description={`Neue Versionen werden angezeigt, aber nicht automatisch installiert.${system.dependencies.checked_at ? ` Geprüft ${formatDateTime(system.dependencies.checked_at)}.` : ""}`}>
              <dl className="system-facts">
                <dt>n8n</dt>
                <dd>{n8n ? (n8n.update ? <span className="mono">{n8n.current} → {n8n.latest}</span> : <><span className="mono">{n8n.current}</span> aktuell</>) : "nicht geprüft"}</dd>
                <dt>npm-Pakete</dt>
                <dd>{npm === null || npm === undefined ? "nicht geprüft" : npm.length === 0 ? "alle aktuell" : `${npm.length} mit neuerer Version`}</dd>
              </dl>
              {npm && npm.length > 0 && (
                <details className="system-details">
                  <summary>Pakete anzeigen</summary>
                  <ul className="system-packages">
                    {npm.map((pkg) => <li key={pkg.name}><span className="mono">{pkg.name}</span> <span className="mono">{pkg.current} → {pkg.latest}</span></li>)}
                  </ul>
                </details>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MonitorRow({ label, entry, now }: { label: string; entry: MonitorEntry; now: Date }) {
  const notes = monitorNotes(entry);
  return (
    <li>
      <div className="system-monitors__head">
        <strong>{label}</strong>
        <StatusChip status={monitorStatus(entry, now)} />
      </div>
      <span className="cell-sub">Geprüft <span className="mono">{formatDateTime(entry.checked_at)}</span></span>
      {notes.length > 0 && (
        <ul className="system-monitors__notes">
          {notes.map((note) => <li key={note.text} className={note.tone === "bad" ? "system-monitors__note--bad" : "cell-sub"}>{note.text}</li>)}
        </ul>
      )}
    </li>
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
