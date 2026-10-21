"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolveAlert } from "@/app/(dashboard)/dashboard/system/actions";

// "Erledigt" in the list of open warnings (task-17-10, admin only). No confirmation: a warning whose cause persists
// is opened again by the next check.
export function ResolveAlertButton({ alertId, title }: { alertId: string; title: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = () => startTransition(async () => {
    setError(null);
    const result = await resolveAlert(alertId);
    if (!result.ok) setError(result.message);
    else router.refresh();
  });
  return (
    <div className="system-action">
      <button type="button" className="button button--secondary" onClick={run} disabled={pending} aria-label={`Erledigt: ${title}`}>
        {pending ? "Wird gespeichert …" : "Erledigt"}
      </button>
      {error && <p className="save-status save-status--error" role="alert">{error}</p>}
    </div>
  );
}
