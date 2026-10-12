import { pausePaymentReminders, resumePaymentReminders, sendPaymentReminder } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import { HiddenField, SaveForm, TextField } from "@/components/dashboard/ui/save-form";
import type { RequestDetail } from "@/lib/dashboard/requests";
import { formatDateTime } from "@/lib/format";
import { stageLabel } from "@/lib/reminders";
import { statusInfo } from "@/lib/status";

// Payment reminders of one invoice (task-10-2): sent stages and, for manager/admin, send now, pause, resume.
export function PaymentReminders({ detail, canManage, today }: { detail: RequestDetail; canManage: boolean; today: string }) {
  const invoice = detail.invoice;
  const state = detail.reminderState;
  if (!invoice || invoice.status === "draft") return null;
  const open = (invoice.status === "issued" || invoice.status === "sent") && !invoice.paid_at;
  const overdue = open && !!invoice.payment_due_date && invoice.payment_due_date < today;
  const hidden = (
    <>
      <HiddenField name="request_id" value={detail.request.id} />
      <HiddenField name="version" value={detail.request.version} />
      <HiddenField name="invoice_id" value={invoice.id} />
    </>
  );
  return (
    <section className="reminders" aria-labelledby="reminders-title">
      <h3 id="reminders-title" className="reminders__title">Zahlungserinnerungen</h3>
      {detail.reminders.length === 0 ? (
        <p className="section-note">Noch keine Erinnerung versendet.</p>
      ) : (
        <ol className="reminders__list">
          {detail.reminders.map((row) => (
            <li key={row.id}>
              <strong>{stageLabel(row.stage)}</strong>
              <span className="mono">{formatDateTime(row.sent_at ?? row.created_at)}</span>
              <span className="cell-sub">{row.message_status ? statusInfo("message_status", row.message_status).label : "–"} · {row.trigger === "manual" ? "manuell ausgelöst" : "automatisch"}</span>
            </li>
          ))}
        </ol>
      )}
      {state?.paused && <p className="rw-blocked">Ausgesetzt seit {formatDateTime(invoice.reminders_paused_at)}: {invoice.reminders_pause_reason}</p>}
      {canManage && open && !detail.request.is_demo && (
        <div className="reminders__actions">
          {overdue && !state?.paused && state?.next_stage && (
            <details className="action">
              <summary>{stageLabel(state.next_stage)} jetzt senden</summary>
              <p className="section-note">Erstellt die E-Mail sofort statt beim nächsten täglichen Lauf. Sie wird mit dem nächsten Versandlauf verschickt.</p>
              <SaveForm action={sendPaymentReminder} submitLabel="Jetzt senden" submitVariant="secondary">{hidden}</SaveForm>
            </details>
          )}
          {state?.paused ? (
            <details className="action">
              <summary>Erinnerungen fortsetzen</summary>
              <p className="section-note">Fällige Stufen werden beim nächsten täglichen Lauf versendet.</p>
              <SaveForm action={resumePaymentReminders} submitLabel="Fortsetzen" submitVariant="secondary">{hidden}</SaveForm>
            </details>
          ) : (
            <details className="action">
              <summary>Erinnerungen aussetzen</summary>
              <p className="section-note">Für diese Rechnung werden keine weiteren Erinnerungen versendet, bis sie fortgesetzt werden.</p>
              <SaveForm action={pausePaymentReminders} submitLabel="Aussetzen" submitVariant="secondary">
                {hidden}
                <TextField name="reason" label="Grund" required hint="z. B. Ratenzahlung vereinbart, Rechnung wird geklärt." />
              </SaveForm>
            </details>
          )}
        </div>
      )}
      {canManage && open && detail.request.is_demo && <p className="section-note">Demo-Anfrage: Erinnerungen werden nicht versendet.</p>}
    </section>
  );
}
