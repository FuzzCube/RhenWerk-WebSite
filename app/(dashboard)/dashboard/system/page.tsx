import type { Metadata } from "next";
import { Card } from "@/components/dashboard/ui/card";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadSystemOverview } from "@/lib/dashboard/system";
import { formatDateTime } from "@/lib/format";
import { alertSourceLabel, systemSummary } from "@/lib/system-summary";

export const metadata: Metadata = { title: "System" };

// Area "System" for the owner (task-17-12): is the data safe, does everything run, is anything to update or top up?
// Admin and manager read the same content. Code updates are not part of the dashboard (nightly run and terminal,
// docs/betrieb.md 6). Backups (task-17-13), state of the systems (task-17-15) and credit (task-17-9) fill the
// sections that still show an empty state.
export default async function SystemPage() {
  await requireRole(rolesFor("/dashboard/system"));
  const system = await loadSystemOverview();
  const summary = systemSummary(system.alerts);
  const critical = summary.alerts.some((alert) => alert.severity === "critical");
  const npm = system.dependencies.npm;
  const n8n = system.dependencies.n8n;

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
              <EmptyState title="Noch keine Prüfung gemeldet." />
            </Card>

            <Card stripe="neutral" title="Guthaben externer Dienste" id="system-guthaben" headingLevel={2}
              description="Guthaben des Telefonassistenten (ElevenLabs) mit Warnung unter dem Schwellwert.">
              <EmptyState title="Noch keine Angaben gemeldet." />
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
