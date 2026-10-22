"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { requestBackup } from "@/app/(dashboard)/dashboard/system/actions";

// "Jetzt sichern" (task-18-6, admin only), e.g. before a larger change by hand. While the request waits or runs, the
// page reloads its data every 5 seconds until the service on the VPS has recorded the backup.
export function BackupButton({ state }: { state: "idle" | "waiting" | "running" | "stuck" }) {
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
    const result = await requestBackup();
    if (!result.ok) setError(result.message);
    else router.refresh();
  });
  const label = pending ? "Wird angefordert …" : state === "running" ? "Sicherung läuft …" : open ? "Sicherung angefordert …" : "Jetzt sichern";
  return (
    <div className="system-backup-action">
      <button type="button" className="button button--secondary" onClick={run} disabled={pending || open} aria-busy={open || pending}>{label}</button>
      <p className="save-status" role="status">
        {state === "stuck" ? "Der Dienst auf dem Server meldet sich nicht (rheinwerk-systemcheck, docs/betrieb.md 4)." : open ? "Sicherung mit Probewiederherstellung dauert etwa eine Minute." : ""}
      </p>
      {error && <p className="save-status save-status--error" role="alert">{error}</p>}
    </div>
  );
}
