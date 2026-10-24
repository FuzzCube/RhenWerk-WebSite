"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, useTransition } from "react";
import { acknowledgeCallback, acknowledgeCallCallback } from "@/app/(dashboard)/dashboard/rueckrufe/actions";
import { Icon } from "@/components/ui";
import type { CallAlert, CallbackAlert } from "@/lib/dashboard/callbacks";
import { telHref } from "@/lib/contact-links";
import { formatTime } from "@/lib/format";
import { useDashboardUpdates } from "./dashboard-updates";

// Rendering and acknowledgement only; the dashboard shell owns the single background poller.
export function CallbackAlerts({ alerts, role }: { alerts: CallbackAlert[]; role: "technician" | "dispatcher" }) {
  const { poll } = useDashboardUpdates();
  // Permission of browser notifications; "unsupported" on the server and without the Notification API
  const browserPermission = useSyncExternalStore(noSubscription, readPermission, () => "unsupported" as const);
  const [asked, setPermission] = useState<NotificationPermission | null>(null);
  const permission = asked ?? browserPermission;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (alerts.length === 0) return null;

  const acknowledge = (alert: CallbackAlert) => startTransition(async () => {
    setError(null);
    const id = alert.id;
    const result = alert.kind === "call" ? await acknowledgeCallCallback(id) : await acknowledgeCallback(id);
    if (!result.ok) setError(result.message);
    else poll();
  });

  return (
    <section className="callback-alerts" aria-label="Rückrufbitten" aria-live="polite">
      {alerts.map((alert) => alert.kind === "call" ? (
        <CallAlertCard key={alert.id} alert={alert} pending={pending} onDone={() => acknowledge(alert)} />
      ) : (
        <article key={alert.id} className="rw-banner rw-banner--danger callback-alert" data-callback-id={alert.id}>
          <Icon name="phone" size={20} />
          <div className="callback-alert__text">
            <p className="callback-alert__title">
              <strong>{role === "dispatcher" ? "Dringend: Rückruf nicht bestätigt" : "Rückrufbitte: Kunde wartet auf Ihren Anruf"}</strong>
            </p>
            <p>
              {role === "technician"
                ? <Link href={`/dashboard/einsatz/${alert.visit_id}`}>{alert.company_name}</Link>
                : <Link href={`/dashboard/anfragen/${alert.request_id}`}>{alert.company_name}</Link>}
              {" · "}{alert.site}
            </p>
            <p className="tech-meta">
              Geplant <span className="mono">{formatTime(alert.scheduled_start)}</span> · gemeldet {alert.by_email ? "per E-Mail " : ""}<span className="mono">{formatTime(alert.created_at)}</span>
              {role === "dispatcher" && alert.technician && <> · Techniker {alert.technician}</>}
            </p>
          </div>
          <div className="callback-alert__actions">
            <a className="button button--primary callback-alert__call" href={telHref(alert.callback_number)}>
              <Icon name="phone" size={18} /><span className="mono">{alert.callback_number}</span>
            </a>
            <button className="rw-button-secondary" type="button" disabled={pending} onClick={() => acknowledge(alert)}>
              <Icon name="check" size={18} />Kunde angerufen
            </button>
          </div>
        </article>
      ))}
      {error && <p className="save-status save-status--error" role="alert">{error}</p>}
      {permission === "default" && (
        <button className="rw-link-btn callback-alerts__permission" type="button"
          onClick={() => void Notification.requestPermission().then(setPermission)}>
          Rückrufbitten auch als Browser-Benachrichtigung anzeigen
        </button>
      )}
    </section>
  );
}

// Urgent call (task-13-6): emergency, danger, production stop or an urgent callback asked for by the assistant
function CallAlertCard({ alert, pending, onDone }: { alert: CallAlert; pending: boolean; onDone: () => void }) {
  return (
    <article className="rw-banner rw-banner--danger callback-alert" data-call-id={alert.id}>
      <Icon name="phone" size={20} />
      <div className="callback-alert__text">
        <p className="callback-alert__title"><strong>Dringender Anruf: bitte zurückrufen</strong></p>
        <p><Link href={`/dashboard/anrufe/${alert.id}`}>{alert.company_name}</Link> · {alert.reason}</p>
        <p className="tech-meta">Telefonassistent · Anruf <span className="mono">{formatTime(alert.created_at)}</span></p>
      </div>
      <div className="callback-alert__actions">
        {alert.callback_number && (
          <a className="button button--primary callback-alert__call" href={telHref(alert.callback_number)}>
            <Icon name="phone" size={18} /><span className="mono">{alert.callback_number}</span>
          </a>
        )}
        <button className="rw-button-secondary" type="button" disabled={pending} onClick={onDone}>
          <Icon name="check" size={18} />Rückruf erledigt
        </button>
      </div>
    </article>
  );
}

const noSubscription = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
