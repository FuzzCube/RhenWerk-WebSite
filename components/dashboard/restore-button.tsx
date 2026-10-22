"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { requestRestore } from "@/app/(dashboard)/dashboard/system/actions";
import { RESTORE_WORD, confirmationMatches } from "@/lib/backups";
import { formatDateTime } from "@/lib/format";

// "Wiederherstellen" in the list of backups (task-18-7, admin only): a dialog says what happens and asks for the word
// WIEDERHERSTELLEN; request_restore checks it again.
export function RestoreButton({ backupId, finishedAt, disabled }: { backupId: string; finishedAt: string; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const id = useId();
  const when = formatDateTime(finishedAt);
  const open = () => { setWord(""); setError(null); dialog.current?.showModal(); };
  const submit = () => startTransition(async () => {
    setError(null);
    const result = await requestRestore(backupId, word);
    if (!result.ok) { setError(result.message); return; }
    dialog.current?.close();
    router.refresh();
  });
  return (
    <>
      <button type="button" className="button button--secondary" onClick={open} disabled={disabled} aria-label={`Wiederherstellen: Sicherung vom ${when}`}>Wiederherstellen</button>
      <dialog ref={dialog} className="system-restore-dialog" aria-labelledby={`${id}-title`}>
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (confirmationMatches(word)) submit(); }}>
          <h2 id={`${id}-title`}>Sicherung vom <span className="mono">{when}</span> wiederherstellen?</h2>
          <ul>
            <li>Alle Daten werden auf diesen Stand zurückgesetzt: Anfragen, Kunden, Rechnungen, Termine, Konten, Dateien und die Automatisierung (n8n). Alles, was danach eingegeben wurde, ist dann nicht mehr da.</li>
            <li>Vorher wird der aktuelle Stand automatisch gesichert. Er steht danach in der Liste als „Vor Wiederherstellung“ und lässt sich genauso zurückholen.</li>
            <li>Website, Dashboard und Automatisierung sind für einige Minuten nicht erreichbar. Danach ist eventuell eine neue Anmeldung nötig.</li>
            <li>Geht etwas schief, kehrt das System selbst zum Stand davor zurück. Das Ergebnis kommt per E-Mail.</li>
          </ul>
          <label className="field" htmlFor={`${id}-word`}>
            <span>Zur Bestätigung {RESTORE_WORD} eingeben</span>
            <input id={`${id}-word`} value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </label>
          {error && <p className="save-status save-status--error" role="alert">{error}</p>}
          <div className="system-restore-dialog__actions">
            <button type="button" className="button button--secondary" onClick={() => dialog.current?.close()} disabled={pending}>Abbrechen</button>
            <button type="submit" className="button button--danger" disabled={pending || !confirmationMatches(word)}>{pending ? "Wird angefordert …" : "Wiederherstellen"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// While a restore waits or runs, the page reloads its data every 5 seconds (during the restore itself the database is
// away for a moment; the page then shows its error state until the next reload succeeds)
export function RestoreProgress({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
