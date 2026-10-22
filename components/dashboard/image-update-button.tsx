"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { requestImageUpdate } from "@/app/(dashboard)/dashboard/system/actions";

// "Update einspielen" (task-18-8, admin only): new image versions from the repository on the VPS. A dialog names the
// services and what happens; request_image_update checks the role again.
export function ImageUpdateButton({ changes, disabled }: { changes: { name: string; current: string | null; latest: string | null }[]; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const id = useId();
  const submit = () => startTransition(async () => {
    setError(null);
    const result = await requestImageUpdate();
    if (!result.ok) { setError(result.message); return; }
    dialog.current?.close();
    router.refresh();
  });
  return (
    <div className="system-image-update">
      <button type="button" className="button button--secondary" onClick={() => { setError(null); dialog.current?.showModal(); }} disabled={disabled}>
        {disabled ? "Update läuft …" : "Update einspielen"}
      </button>
      <dialog ref={dialog} className="system-restore-dialog" aria-labelledby={`${id}-title`}>
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <h2 id={`${id}-title`}>Systemupdate einspielen?</h2>
          <ul className="system-image-update__list">
            {changes.map((change) => <li key={change.name}><strong>{change.name}</strong> <span className="mono">{change.current} → {change.latest}</span></li>)}
          </ul>
          <ul>
            <li>Vorher wird alles gesichert (in der Liste als „Vor Systemupdate“).</li>
            <li>Website, Dashboard und Automatisierung sind einige Minuten nicht erreichbar.</li>
            <li>Danach prüft ein Selbsttest Datenbank, Anmeldung, Rechte, Dateien und n8n. Scheitert er, laufen automatisch wieder die Versionen und Daten von vorher. Das Ergebnis kommt per E-Mail.</li>
          </ul>
          {error && <p className="save-status save-status--error" role="alert">{error}</p>}
          <div className="system-restore-dialog__actions">
            <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()} disabled={pending}>Abbrechen</button>
            <button type="submit" className="button button--primary" disabled={pending}>{pending ? "Wird angefordert …" : "Update einspielen"}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
