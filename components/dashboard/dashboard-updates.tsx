"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import { CallbackAlerts } from "./callback-alerts";
import { SendBacklogAlert } from "./send-backlog-alert";
import { SystemAlertBanner } from "./system-alert-banner";
import { callbackEvent, eventTargetOpen, freshDashboardEvents, type DashboardEvent, type DashboardSnapshot } from "@/lib/dashboard-notifications";

const DashboardUpdatesContext = createContext<{ snapshot: DashboardSnapshot | null; poll: () => void }>({ snapshot: null, poll: () => {} });
export const useDashboardUpdates = () => useContext(DashboardUpdatesContext);

// All dashboard notifications share this one poller. Layout state survives section changes and router.refresh().
export function DashboardUpdates({ initial, employeeId, children }: { initial: DashboardSnapshot | null; employeeId: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState(initial);
  const [toasts, setToasts] = useState<DashboardEvent[]>([]);
  const [connection, setConnection] = useState<"ok" | "offline" | "expired">(initial ? "ok" : "offline");
  const [available, setAvailable] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const refreshInProgress = useRef(false);
  const latest = useRef(initial);
  const seen = useRef(new Set(initial?.events.map((event) => event.id)));
  const appliedRevision = useRef(initial?.revision);
  const running = useRef(false);
  const queued = useRef(false);
  const stopped = useRef(false);
  const request = useRef<AbortController | null>(null);

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const apply = useCallback((next: DashboardSnapshot) => {
    if (dashboardIsBusy()) {
      setAvailable(true);
      return;
    }
    appliedRevision.current = next.revision;
    setAvailable(false);
    startRefresh(() => router.refresh());
  }, [router]);

  const poll = useCallback(async function poll() {
    if (stopped.current) return;
    if (running.current) {
      queued.current = true;
      return;
    }
    running.current = true;
    queued.current = false;
    const controller = new AbortController();
    request.current = controller;
    try {
      const since = latest.current ? `?seit=${encodeURIComponent(latest.current.cursor)}` : "";
      const response = await fetch(`/dashboard/aktualisierungen${since}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (response.status === 401) {
        stopped.current = true;
        setConnection("expired");
        setSnapshot(null);
        setToasts([]);
        return;
      }
      if (!response.ok) throw new Error("Aktualisierung fehlgeschlagen");
      const next = await response.json() as DashboardSnapshot;
      if (controller.signal.aborted) return;
      if (next.employeeId !== employeeId || (latest.current && next.role !== latest.current.role)) {
        stopped.current = true;
        setSnapshot(null);
        setToasts([]);
        setConnection("expired");
        return;
      }
      const fresh = freshDashboardEvents(next.events, seen.current);
      // An unavailable initial snapshot establishes its baseline on the first successful request, silently.
      if (latest.current && fresh.length) {
        setToasts((current) => [...fresh, ...current]);
        const callbacks = fresh.filter((event) => event.id.startsWith("callback:"));
        if (callbacks.length) {
          try {
            navigator.vibrate?.([200, 100, 200]);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              for (const event of callbacks) {
                const alert = next.callbacks.find((item) => callbackEvent(item, next.role).id === event.id);
                const body = alert?.kind === "call" ? `${alert.company_name} · ${alert.reason}`
                  : alert ? `${alert.company_name} · ${alert.site} · ${alert.callback_number}` : undefined;
                new Notification(event.title, { tag: event.id, body });
              }
            }
          } catch {
            // Optional OS notifications can be blocked even with permission. In-app updates must still succeed.
          }
        }
      }
      latest.current = next;
      setSnapshot(next);
      setConnection("ok");
      if (next.revision !== appliedRevision.current) {
        // A focused field, a save or any board action may be in progress before the next input event fires.
        if (dashboardHasEdits() || refreshInProgress.current) setAvailable(true);
        else apply(next);
      }
    } catch {
      if (!controller.signal.aborted) setConnection("offline");
      // Retain cursor, counters, banners and seen IDs. Reconnection continues from the last successful read.
    } finally {
      running.current = false;
      if (queued.current && !controller.signal.aborted && !stopped.current) queueMicrotask(() => void poll());
    }
  }, [apply, employeeId]);

  useEffect(() => { refreshInProgress.current = refreshing; }, [refreshing]);

  useEffect(() => {
    const onReturn = () => { if (document.visibilityState === "visible") void poll(); };
    const onOnline = () => { void poll(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onOnline);
    window.addEventListener("dashboard:changed", onReturn);
    // Includes actions already performed since server rendering and a failed initial load.
    queueMicrotask(() => void poll());
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("dashboard:changed", onReturn);
      request.current?.abort();
    };
  }, [poll]);

  // Keep the existing urgent callback notifications working in background tabs too; browsers may throttle timers.
  // While the automation works on a request, every 5 s, so "KI arbeitet …" and its result show up promptly (task-26-3)
  const fastPoll = Boolean(snapshot?.automationPending);
  useEffect(() => {
    const timer = window.setInterval(() => void poll(), fastPoll ? 5_000 : 20_000);
    return () => window.clearInterval(timer);
  }, [poll, fastPoll]);

  // Native/custom forms outside SaveForm are protected too. SaveForm manages its own dirty/saving state.
  useEffect(() => {
    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest("#dash-main")) return;
      const form = target.closest("form");
      if (form && !form.classList.contains("save-form")) form.dataset.dashboardDirty = "true";
    };
    const onReset = (event: Event) => {
      if (event.target instanceof HTMLFormElement && !event.target.classList.contains("save-form")) delete event.target.dataset.dashboardDirty;
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    document.addEventListener("reset", onReset, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      document.removeEventListener("reset", onReset, true);
    };
  }, []);

  // Callback title count, also after a section navigation changes the document title.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = snapshot?.callbacks.length ? `(${snapshot.callbacks.length}) ${base}` : base;
  }, [snapshot, pathname]);

  return <DashboardUpdatesContext.Provider value={{ snapshot, poll }}>
    {children}
    <Suspense fallback={null}><DashboardNotices toasts={toasts} setToasts={setToasts} dismiss={dismiss} /></Suspense>
    <div className="dash-update-status" aria-live="polite">
      {connection === "expired" ? <p>Sitzung oder Berechtigung geändert. <Link href="/login">Erneut anmelden</Link></p>
        : connection === "offline" ? <p>Aktualisierung unterbrochen. Letzter Stand bleibt erhalten.</p> : null}
      {available && connection !== "expired" && <div>
        <span>Neue Daten verfügbar. Ihre Eingaben und Auswahl bleiben bis zur Aktualisierung erhalten.</span>{" "}
        <button type="button" className="button button--secondary" disabled={refreshing || dashboardIsBusy()}
          onClick={() => latest.current && apply(latest.current)}>{refreshing ? "Wird aktualisiert …" : "Daten aktualisieren"}</button>
      </div>}
    </div>
  </DashboardUpdatesContext.Provider>;
}

function DashboardNotices({ toasts, setToasts, dismiss }: {
  toasts: DashboardEvent[]; setToasts: (update: (current: DashboardEvent[]) => DashboardEvent[]) => void; dismiss: (id: string) => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  // Opening the target yourself counts as handling it. Only navigation closes: a notice arriving on its own target page stays.
  useEffect(() => {
    setToasts((current) => current.some((event) => eventTargetOpen(event.href, pathname, search))
      ? current.filter((event) => !eventTargetOpen(event.href, pathname, search)) : current);
  }, [pathname, search, setToasts]);
  // task-27-1: sonner shows and animates the notices (new ones slide in at the bottom, the others move up, closing
  // fades out); which notices exist stays here. Info notices close after 6 s, held while pointer or focus rests on them.
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(toasts.map((event) => event.id));
    for (const event of toasts) {
      if (shown.current.has(event.id)) continue;
      shown.current.add(event.id);
      toast.custom(() => <DashboardNotice event={event} dismiss={dismiss} />, {
        id: event.id, duration: event.info ? 6_000 : Infinity, onDismiss: () => dismiss(event.id), onAutoClose: () => dismiss(event.id),
      });
    }
    for (const id of shown.current) {
      if (ids.has(id)) continue;
      shown.current.delete(id);
      toast.dismiss(id);
    }
  }, [toasts, dismiss]);
  return <Toaster className="dash-notices" containerAriaLabel="Neue Ereignisse" position="bottom-right" expand visibleToasts={5} gap={8}
    style={{ "--width": "380px" } as CSSProperties}
    offset={{ right: 20, bottom: 90 }} mobileOffset={{ left: 16, right: 16, bottom: 150 }} swipeDirections={["right"]} />;
}

function DashboardNotice({ event, dismiss }: { event: DashboardEvent; dismiss: (id: string) => void }) {
  return <div className="dash-notice rw-card rw-card--neutral" data-notification-id={event.id} data-notification-info={event.info ? "true" : undefined}>
    <Link href={event.href} onClick={() => dismiss(event.id)}>{event.title}</Link>
    <button className="rw-link-btn" type="button" aria-label="Hinweis schließen" onClick={() => dismiss(event.id)}>×</button>
  </div>;
}

export function DashboardAlertBanners() {
  const { snapshot } = useDashboardUpdates();
  if (!snapshot) return null;
  return <>
    {snapshot.backlog && <SendBacklogAlert backlog={snapshot.backlog} role={snapshot.role} />}
    <SystemAlertBanner alerts={snapshot.systemAlerts} />
    {(snapshot.role === "technician" || snapshot.role === "dispatcher") && <CallbackAlerts alerts={snapshot.callbacks} role={snapshot.role} />}
  </>;
}

function dashboardIsBusy() {
  return typeof document !== "undefined" && !!document.querySelector('#dash-main [data-dashboard-busy="true"], #dash-main [aria-busy="true"]');
}
function dashboardHasEdits() {
  return dashboardIsBusy() || !!document.querySelector('#dash-main [data-dashboard-dirty="true"]')
    || (document.activeElement instanceof HTMLElement && !!document.activeElement.closest('#dash-main input:not([type="hidden"]), #dash-main textarea, #dash-main select, #dash-main [contenteditable="true"]'));
}
