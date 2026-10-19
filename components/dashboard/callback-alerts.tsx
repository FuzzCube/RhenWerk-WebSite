"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { acknowledgeCallback, acknowledgeCallCallback } from "@/app/(dashboard)/dashboard/rueckrufe/actions";
import { Icon } from "@/components/ui";
import type { CallAlert, CallbackAlert } from "@/lib/dashboard/callbacks";
import { telHref } from "@/lib/contact-links";
import { formatTime } from "@/lib/format";

// Callback requests of the phone assistant (task-13-4) as notification on every dashboard page. The layout is not
// re-rendered on client navigation, so the banner polls /dashboard/rueckrufe (every 20 s and when the tab becomes
// visible). New requests also raise a browser notification if the user allowed it, and the tab title shows the count.
const POLL_MS = 20_000;

export function CallbackAlerts({ initial, role }: { initial: CallbackAlert[]; role: "technician" | "dispatcher" }) {
  const [alerts, setAlerts] = useState(initial);
  // Permission of browser notifications; "unsupported" on the server and without the Notification API
  const browserPermission = useSyncExternalStore(noSubscription, readPermission, () => "unsupported" as const);
  const [asked, setPermission] = useState<NotificationPermission | null>(null);
  const permission = asked ?? browserPermission;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const seen = useRef(new Set(initial.map((alert) => alert.id)));

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/dashboard/rueckrufe", { cache: "no-store" });
      if (!response.ok) return;
      const { alerts: next } = (await response.json()) as { alerts: CallbackAlert[] };
      const fresh = next.filter((alert) => !seen.current.has(alert.id));
      fresh.forEach((alert) => seen.current.add(alert.id));
      if (fresh.length > 0) notify(fresh, role);
      setAlerts(next);
    } catch {
      // Offline or server restart: keep the last state and try again on the next tick
    }
  }, [role]);

  useEffect(() => {
    const timer = window.setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [poll]);

  // Count in the tab title while requests are open
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = alerts.length ? `(${alerts.length}) ${base}` : base;
  }, [alerts.length]);

  if (alerts.length === 0) return null;

  const acknowledge = (alert: CallbackAlert) => startTransition(async () => {
    setError(null);
    const id = alert.id;
    const result = alert.kind === "call" ? await acknowledgeCallCallback(id) : await acknowledgeCallback(id);
    if (!result.ok) setError(result.message);
    else setAlerts((current) => current.filter((alert) => alert.id !== id));
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
              Geplant <span className="mono">{formatTime(alert.scheduled_start)}</span> · gemeldet <span className="mono">{formatTime(alert.created_at)}</span>
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

function notify(fresh: CallbackAlert[], role: "technician" | "dispatcher") {
  navigator.vibrate?.([200, 100, 200]);
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  for (const alert of fresh) {
    new Notification(alert.kind === "call" ? "Dringender Anruf" : role === "dispatcher" ? "Dringend: Rückruf nicht bestätigt" : "Rückrufbitte: Kunde wartet", {
      body: alert.kind === "call" ? `${alert.company_name} · ${alert.reason}${alert.callback_number ? ` · ${alert.callback_number}` : ""}` : `${alert.company_name} · ${alert.site} · ${alert.callback_number}`,
      tag: `callback-${alert.id}`,
    });
  }
}
