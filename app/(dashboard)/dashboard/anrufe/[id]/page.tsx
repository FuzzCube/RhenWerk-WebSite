import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { markCallbackDone } from "@/app/(dashboard)/dashboard/anrufe/actions";
import { CallShell } from "@/components/dashboard/call-shell";
import { HiddenField, SaveForm } from "@/components/dashboard/ui/save-form";
import { RequestStatusChip, StatusChip } from "@/components/dashboard/ui/status-chip";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { callStatus, formatCallDuration, FORWARD_LABEL, getCall } from "@/lib/dashboard/calls";
import { getEmployeeNames } from "@/lib/dashboard/requests";
import { telHref } from "@/lib/contact-links";
import { EMPTY, formatCurrency, formatDate, formatDateTime, formatNumber, formatTime } from "@/lib/format";
import { label } from "@/lib/status";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Anruf" };

const TRANSCRIPT_DAYS = 30;

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {items.map(([term, value]) => (
        <div key={term}><dt>{term}</dt><dd>{value === null || value === undefined || value === "" ? EMPTY : value}</dd></div>
      ))}
    </dl>
  );
}

// One call (task-13-7): summary and facts of the evaluation, callback, linked request and customer, transcript
// (deleted after 30 days, the summary stays). Facts like "Anfrage angelegt" come from the database, not from the model.
export default async function CallPage({ params }: Props) {
  await requireRole(rolesFor("/dashboard/anrufe"));
  const { id } = await params;
  const [call, names] = await Promise.all([getCall(id), getEmployeeNames()]);
  if (!call) notFound();
  const status = callStatus(call);
  const transcriptUntil = new Date(new Date(call.ended_at ?? call.started_at).getTime() + TRANSCRIPT_DAYS * 86_400_000);
  const number = call.callback_number ?? call.caller_number;

  return (
    <CallShell
      current={null}
      counts={null}
      title={call.company}
      description={<>Anruf <span className="mono">{formatDateTime(call.started_at)}</span> · {formatCallDuration(call.duration_seconds)}{call.is_demo && <> <span className="demo-tag">Demodaten</span></>}</>}
    >
      <p><Link href="/dashboard/anrufe">← Alle Anrufe</Link></p>

      <section className="request-section" aria-labelledby="zusammenfassung-title">
        <h2 id="zusammenfassung-title">Zusammenfassung</h2>
        <div className="badge-row"><StatusChip status={status} /></div>
        {call.summary ? (
          <blockquote className="request-quote">
            <p>{call.summary}</p>
            <footer>Automatische Auswertung des Gesprächs</footer>
          </blockquote>
        ) : (
          <p className="section-note">{call.analyzed_at ? "Keine Zusammenfassung." : "Das Gespräch wird nach dem Ende innerhalb weniger Minuten ausgewertet."}</p>
        )}
        <Facts items={[
          ["Kategorie", call.category ? label("call_category", call.category) : null],
          ["Dringlichkeit", call.urgency ? label("customer_urgency", call.urgency) : null],
          ["Sicherheitsgefahr", call.safety_risk ? label("safety_risk", call.safety_risk) : null],
          ["Servicezeit", call.in_service_hours === null ? null : call.in_service_hours ? "Innerhalb" : "Außerhalb (Service Desk nicht besetzt)"],
          ["Weiterleitung", call.forward_target ? <>An {FORWARD_LABEL[call.forward_target] ?? call.forward_target} (Demo, nicht verbunden) · <span className="mono">{formatTime(call.forwarded_at)}</span>{call.forward_reason && <> · {call.forward_reason}</>}</> : "Keine"],
          ["Ansprechperson", call.contact],
          ["Stimmung", call.sentiment ? label("call_sentiment", call.sentiment) : null],
          ["Kosten", call.cost_cents === null && call.credits === null ? null : <>{formatCurrency((call.cost_cents ?? 0) / 100)}{call.credits !== null && <> · <span className="mono">{formatNumber(call.credits)}</span> Credits</>}</>],
        ]} />
      </section>

      <section className="request-section" aria-labelledby="bezug-title">
        <h2 id="bezug-title">Anfrage und Kunde</h2>
        <Facts items={[
          ["Anfrage", call.request ? (
            <span key="r" className="call-ref">
              <Link href={`/dashboard/anfragen/${call.request.id}`} className="mono">{call.request.request_number}</Link>
              <span className="cell-sub">{call.createdRequest ? "im Gespräch angelegt" : "im Gespräch genannt"}</span>
              <RequestStatusChip intakeStatus={call.request.intake_status} workStatus={call.request.work_status} />
            </span>
          ) : "Keine"],
          ["Kunde", call.customer ? <Link key="c" href={`/dashboard/kunden/${call.customer.id}`}>{call.customer.company_name} <span className="mono">{call.customer.customer_number}</span></Link> : "Nicht erkannt"],
        ]} />
      </section>

      <section className="request-section" aria-labelledby="rueckruf-title">
        <h2 id="rueckruf-title">Rückruf</h2>
        {!call.callback_needed ? (
          <p className="section-note">Kein Rückruf nötig: Der Telefonassistent hat das Anliegen ohne Mitarbeiter abgeschlossen.</p>
        ) : (
          <>
            <Facts items={[
              ["Grund", call.callback_reason],
              ["Rückrufnummer", number ? <a key="n" href={telHref(number)} className="mono">{number}</a> : null],
              ["Dringend", call.callback_urgent ? "Ja" : "Nein"],
              ["Erledigt", call.callback_done_at ? <>{formatDateTime(call.callback_done_at)} · {call.callback_done_by ? names.get(call.callback_done_by) ?? "Unbekannte Person" : EMPTY}</> : "Noch offen"],
            ]} />
            {!call.callback_done_at && (
              <SaveForm action={markCallbackDone} submitLabel="Rückruf erledigt">
                <HiddenField name="call_id" value={call.id} />
              </SaveForm>
            )}
          </>
        )}
      </section>

      <section className="request-section" aria-labelledby="transkript-title">
        <h2 id="transkript-title">Transkript</h2>
        {call.transcript ? (
          <>
            <p className="section-note">Wird am <span className="mono">{formatDate(transcriptUntil)}</span> gelöscht ({TRANSCRIPT_DAYS} Tage nach dem Gespräch); die Zusammenfassung bleibt.</p>
            <ol className="call-transcript" aria-label="Gesprächsverlauf">
              {call.transcript.split("\n").filter(Boolean).map((line, index) => {
                const match = /^(Mira|Anrufer): (.*)$/.exec(line);
                if (!match) return <li key={index} className="call-transcript__tool">{line}</li>;
                return (
                  <li key={index} className={`call-transcript__turn call-transcript__turn--${match[1] === "Mira" ? "agent" : "caller"}`}>
                    <strong>{match[1]}</strong> {match[2]}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="section-note">
            {call.transcript_deleted_at ? <>Nach {TRANSCRIPT_DAYS} Tagen gelöscht am <span className="mono">{formatDate(call.transcript_deleted_at)}</span>.</> : "Kein Transkript gespeichert."}
          </p>
        )}
      </section>
    </CallShell>
  );
}
