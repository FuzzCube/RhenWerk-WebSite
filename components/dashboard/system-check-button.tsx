"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { requestSystemCheck } from "@/app/(dashboard)/dashboard/system/actions";

// "System prüfen" (task-17-15, admin only), e.g. after a manual update of Docker Desktop. While the request waits or
// runs, the page reloads its data every 5 seconds until the service on the host has finished.
export function SystemCheckButton({ state }: { state: "idle" | "waiting" | "running" | "stuck" }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const open = state === "waiting" || state === "running" || state === "stuck";
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [open, router]);
  const run = () => startTransition(async () => {
    setError(null);
    const result = await requestSystemCheck();
    if (!result.ok) setError(result.message);
    else router.refresh();
  });
  const label = pending ? "Wird angefordert …" : state === "running" ? "Prüfung läuft …" : open ? "Prüfung angefordert …" : "System prüfen";
  return (
    <div className="system-check">
      <button type="button" className="button button--secondary" onClick={run} disabled={pending || open} aria-busy={open || pending}>{label}</button>
      <p className="save-status" role="status">
        {state === "stuck" ? "Der Prüfdienst auf dem Server meldet sich nicht (rheinwerk-systemcheck, docs/betrieb.md 3.5)." : open ? "Ergebnisse erscheinen in etwa einer Minute." : ""}
      </p>
      {error && <p className="save-status save-status--error" role="alert">{error}</p>}
    </div>
  );
}
