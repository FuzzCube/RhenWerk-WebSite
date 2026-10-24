import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createCustomerFromRequest, linkCustomer, markMessagesRead, rejectHold } from "@/app/(dashboard)/dashboard/anfragen/[id]/actions";
import { availableActions, DraftActions, IntakeForm, RequestAction, RequestActions } from "@/components/dashboard/request-actions";
import { CheckboxField, HiddenField, SaveForm, SelectField, SuggestField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { PaymentForm } from "@/components/dashboard/payment-form";
import { PaymentReminders } from "@/components/dashboard/payment-reminders";
import { InvoiceStatusChip, PriorityText, StatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { invoiceDisplayStatus, requestDisplayStatus, requestProgress } from "@/lib/display-status";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatCallDuration } from "@/lib/dashboard/calls";
import { isUnreadMessage, unreadText } from "@/lib/dashboard/unread";
import { getEmployeeNames, getRequestDetail, sectionsFor, type CustomerSuggestion, type RequestDetail, type SectionId } from "@/lib/dashboard/requests";
import { describeEvent } from "@/lib/events";
import { berlinDayKey, EMPTY, formatCalendarDate, formatCurrency, formatDateTime, formatMinutes, formatNumber, formatPercent, formatTimeRange, formatWish } from "@/lib/format";
import { nextReminderText, stageLabel } from "@/lib/reminders";
import { contractHint } from "@/lib/service-contract";
import { label, statusInfo } from "@/lib/status";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const detail = await getRequestDetail((await params).id, employee.role);
  return { title: detail ? `${detail.request.request_number} – ${detail.request.company_name}` : "Anfrage" };
}

export default async function RequestPage({ params }: Props) {
  const employee = await requireRole(rolesFor("/dashboard/anfragen"));
  const { id } = await params;
  const [detail, names] = await Promise.all([getRequestDetail(id, employee.role), getEmployeeNames()]);
  // Unknown id and missing access look the same
  if (!detail) notFound();

  const { request } = detail;
  const sections = sectionsFor(employee.role);
  const person = (personId: string | null | undefined, fallback = "Nicht zugewiesen") => (personId ? names.get(personId) ?? "Unbekannte Person" : fallback);
  const failed = (section: SectionId) => detail.failed.includes(section);
  // Technician view (user request 09.10.2026): own visit first, only the technical facts, history folded
  const technician = employee.role === "technician";
  const heroVisit = technician ? ownNextVisit(detail.visits, employee.id) : undefined;
  const actions = availableActions(detail, employee);
  // Planning happens on the planning page; the request page points there as the next step
  const openHold = detail.holds.find((hold) => hold.status === "open") ?? null;
  const canPlan = (employee.role === "dispatcher" || employee.role === "manager" || employee.role === "admin") && request.intake_status === "processed" && ["not_planned", "waiting_parts"].includes(request.work_status);
  // Staff (user request 24.10.2026, task-22-1): every action sits in the section it belongs to, the side column only
  // shows the customer. The technician keeps the next-step card.
  const staff = !technician;
  const action = (kind: Parameters<typeof RequestAction>[0]["kind"]) => staff && actions[kind] && <RequestAction detail={detail} employee={employee} kind={kind} />;
  const render: Record<SectionId, () => ReactNode> = {
    zusammenfassung: () => <Summary detail={detail} />,
    kontakt: () => <><Contact detail={detail} dispatcher={technician ? person(request.dispatcher_id, "nicht zugewiesen") : undefined} />{staff && <CustomerLink detail={detail} />}</>,
    anlage: () => <Equipment detail={detail} technical={technician} />,
    erstbearbeitung: () => <><Intake detail={detail} person={person} />{staff && (actions.correct || actions.complete || actions.await) && <IntakeForm detail={detail} employee={employee} />}</>,
    // task-22-2: a new e-mail is written below the messages it answers
    korrespondenz: () => <><Correspondence detail={detail} person={person} editable={staff} />{action("email")}</>,
    einsaetze: () => <>{staff && canPlan && <PlanNext request={request} hold={openHold} person={person} />}<Visits detail={detail} person={person} employee={employee} /></>,
    arbeit: () => <>{action("close")}<Work detail={detail} person={person} /></>,
    dokumente: () => <Documents detail={detail} person={person} />,
    rechnung: () => <>{action("createInvoice")}{action("issueInvoice")}<Invoice detail={detail} canPay={employee.role === "manager" || employee.role === "admin"} /></>,
    verlauf: () => <History detail={detail} names={names} folded={technician} />,
  };

  // Unread customer e-mails (task-20-14); technicians do not get the messages at all
  const unread = (detail.messages ?? []).filter((message) => isUnreadMessage(message, request.created_at));
  // Customer reply about the visit (task-20-10): shown until a person plans, moves or cancels a visit afterwards
  const lastReply = technician ? undefined : detail.events.find((event) => event.event_type === "visit_reply_analyzed");
  const replyNotice = lastReply && ["cancelled", "flagged"].includes(lastReply.to_value ?? "")
    && !detail.events.some((event) => event.actor_type === "user" && ["visit_scheduled", "visit_rescheduled", "visit_status_changed"].includes(event.event_type) && event.occurred_at > lastReply.occurred_at)
    ? lastReply : undefined;
  const hasActions = Object.values(actions).some(Boolean);
  const closedFor = !technician ? null
    : request.work_status === "completed" ? "completed"
    : request.intake_status === "rejected" ? "rejected"
    : request.intake_status === "cancelled" || request.work_status === "cancelled" ? "cancelled" : null;
  const invoiceLater = technician && request.technician_id === employee.id && !detail.invoice
    && !["rejected", "cancelled"].includes(request.intake_status) && !["completed", "cancelled"].includes(request.work_status);
  const progress = requestProgress(request.intake_status, request.work_status);
  const status = requestDisplayStatus(request.intake_status, request.work_status);
  const lastAnalysis = [...(detail.automationRuns ?? [])].reverse().find((run) => run.step === "intake_analysis" && run.confidence !== null);

  // Sections without entries are summarized in one line (specification section 06); anchors stay
  // Staff: the correspondence is always open to write an e-mail; a section with an action is never summarized away
  const empty: Partial<Record<SectionId, string>> = {
    korrespondenz: technician && detail.messages && detail.messages.length === 0 ? "keine Nachrichten" : undefined,
    einsaetze: detail.visits.length === 0 && !canPlan ? "noch kein Einsatz geplant" : undefined,
    arbeit: detail.workEntries.length === 0 && !request.completion_summary && !(staff && actions.close) ? "keine Arbeitspositionen" : undefined,
    dokumente: detail.attachments.length === 0 ? "keine Dokumente" : undefined,
    rechnung: !detail.invoice && !(staff && actions.createInvoice) ? "keine Rechnung" : undefined,
  };
  // A technician sees the own visit on top; the visit table only adds value with further visits
  const side: readonly SectionId[] = technician && heroVisit && detail.visits.length === 1 ? ["kontakt", "einsaetze"] : ["kontakt"];
  const main = sections.filter((section) => !side.includes(section.id) && !(empty[section.id] && !failed(section.id)));
  const collapsed = sections.filter((section) => empty[section.id] && !failed(section.id));
  // Staff (user feedback 12.10.2026): secondary sections fold to one line with a summary; what the
  // current step needs stays open. The technician view keeps its own order and folding.
  const fold = technician ? null : foldState(detail);
  const section = (id: SectionId, sectionLabel: string) => {
    const body = failed(id)
      ? <ErrorState title="Dieser Abschnitt konnte nicht geladen werden." action={<Link className="rw-button-secondary" href={`/dashboard/anfragen/${request.id}#${id}`}>Erneut versuchen</Link>}>Die übrigen Abschnitte sind aktuell.</ErrorState>
      : render[id]();
    const folding = fold?.[id];
    if (!folding || failed(id)) {
      return (
        <section key={id} id={id} className="rw-card rw-card--neutral request-card" aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>{sectionLabel}</h2>
          {body}
        </section>
      );
    }
    return (
      <section key={id} id={id} className="rw-card rw-card--neutral request-card request-card--fold" aria-labelledby={`${id}-title`}>
        <details open={folding.open || undefined}>
          <summary>
            <span className="request-card__titles">
              <h2 id={`${id}-title`}>{sectionLabel}</h2>
              <span className="request-card__summary">{folding.summary}</span>
            </span>
            <span className="request-card__toggle" aria-hidden="true"><Icon name="chevron-down" size={18} /></span>
          </summary>
          <div className="request-card__body">{body}</div>
        </details>
      </section>
    );
  };

  return (
    // Staff view as wide as the list pages; the technician view keeps the reading width
    <div className={`dash-page dash-request${technician ? "" : " dash-request--wide"}`}>
      <nav className="breadcrumb-dash" aria-label="Pfad">
        <Link href="/dashboard/anfragen">Anfragen</Link> <span aria-hidden="true">/</span> <span className="mono">{request.request_number}</span>
      </nav>
      <header className="request-head">
        <div>
          <p className="mono request-head__number">{request.request_number}{request.is_demo && <span className="demo-tag">Demodaten</span>}</p>
          <h1>{request.company_name}</h1>
          <p className="request-head__meta">
            {label("service_kind", request.service_kind)} · {label("equipment_kind", request.equipment_kind)} · <span className="mono">{request.postal_code}</span> {request.city} · eingegangen <span className="mono">{formatDateTime(request.created_at)}</span> über {label("request_source", request.source)}
          </p>
        </div>
        <div className="badge-row">
          <StatusChip status={status} />
          {request.priority && <PriorityText priority={request.priority} />}
        </div>
      </header>

      {detail.change && !technician && (
        // task-20-16: the customer wants to move the planned visit; decided on the planning board
        <section id="verschiebewunsch" className="rw-banner rw-banner--change" aria-labelledby="verschiebewunsch-title">
          <Icon name="calendar" size={22} />
          <div className="unread-banner__text">
            <h2 id="verschiebewunsch-title" className="unread-banner__title">{detail.change.status === "offered" ? "Vorschlag gesendet – der Kunde antwortet noch" : "Der Kunde möchte den Termin verschieben"}</h2>
            <p className="unread-banner__more">Wunsch: <strong>{formatWish(detail.change.wished_day, detail.change.wished_time)}</strong>{detail.change.wish_summary ? <> · „{detail.change.wish_summary}“</> : null}</p>
            {detail.change.status === "offered" && detail.change.offered_start && detail.change.offered_end && (
              <p className="unread-banner__more">Angebot: <span className="mono">{formatTimeRange(detail.change.offered_start, detail.change.offered_end)}</span>. Sagt der Kunde zu, wird der Termin automatisch verschoben.</p>
            )}
          </div>
          <div className="unread-banner__actions">
            <Link className="rw-button-secondary" href={`/dashboard/planung?anfrage=${request.id}`}>Auf der Plantafel bearbeiten</Link>
          </div>
        </section>
      )}

      {unread.length > 0 && (
        // task-20-14: the customer wrote (cancel, move, a question) and nobody has marked it as read yet
        <section id="neue-nachrichten" className="rw-banner rw-banner--unread" aria-labelledby="neue-nachrichten-title">
          <Icon name="mail" size={22} />
          <div className="unread-banner__text">
            <h2 id="neue-nachrichten-title" className="unread-banner__title">{unreadText(unread.length)}</h2>
            <ul className="unread-banner__list">
              {unread.slice(-3).reverse().map((message) => (
                <li key={message.id}>
                  <a href={`#nachricht-${message.id}`}><strong>{message.subject}</strong></a>
                  <span className="mono"> · {formatDateTime(message.received_at ?? message.created_at)}</span>
                  <span className="unread-banner__excerpt">{excerpt(message.body_text)}</span>
                </li>
              ))}
            </ul>
            {unread.length > 3 && <p className="unread-banner__more">und {unread.length - 3} weitere in der Korrespondenz</p>}
          </div>
          <div className="unread-banner__actions">
            <a className="rw-button-secondary" href="#korrespondenz">Zur Korrespondenz</a>
            <SaveForm action={markMessagesRead} submitLabel="Als gelesen markieren" submitVariant="secondary">
              <HiddenField name="request_id" value={request.id} />
            </SaveForm>
          </div>
        </section>
      )}

      {progress && (
        <ol className="rw-progress" aria-label="Status der Anfrage">
          {progress.map((step) => (
            <li key={step.label} className={`rw-progress__step rw-progress__step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
              <span className="rw-progress__bar" aria-hidden="true" />
              <span>{step.state === "done" && <span className="sr-only">Erledigt: </span>}{step.state === "current" && <span className="sr-only">Jetzt: </span>}{step.label}</span>
            </li>
          ))}
        </ol>
      )}

      {request.safety_risk !== "none_known" && (
        <div className="rw-banner rw-banner--danger" role="alert">
          <Icon name="hazard" size={20} />
          <p>
            <strong>Sicherheitsgefahr: {label("safety_risk", request.safety_risk)}.</strong> Vor Arbeitsbeginn Sicherheitslage klären.
            {request.human_review_required && <> Menschliche Prüfung erforderlich{lastAnalysis?.confidence != null ? <> – die automatische Analyse war unsicher (Konfidenz <span className="mono">{formatPercent(lastAnalysis.confidence * 100, 0)}</span>)</> : ""}.</>}
          </p>
        </div>
      )}
      {request.safety_risk === "none_known" && request.human_review_required && (
        <p className="rw-banner rw-banner--info">Menschliche Prüfung erforderlich{lastAnalysis?.confidence != null ? <> – Konfidenz der automatischen Analyse <span className="mono">{formatPercent(lastAnalysis.confidence * 100, 0)}</span></> : ""}.</p>
      )}

      {technician && <VisitHero visit={heroVisit} request={request} />}

      {/* Technician: one column on every width (as on tablets); next step and contact share one row */}
      <div className={`request-layout${technician ? " request-layout--single" : ""}`}>
        <div className="request-layout__main">
          {replyNotice && <VisitReplyNotice event={replyNotice} requestId={request.id} />}
          {main.map((item) => section(item.id, item.label))}
          {collapsed.length > 0 && (
            <div className="rw-collapsed" aria-label="Bereiche ohne Einträge">
              {collapsed.map((item, index) => (
                <section key={item.id} id={item.id} aria-labelledby={`${item.id}-title`}>
                  <h2 id={`${item.id}-title`}>{item.label}</h2>: {empty[item.id]}{index < collapsed.length - 1 ? " · " : ""}
                </section>
              ))}
              <span className="rw-collapsed__note"> Diese Bereiche erscheinen, sobald es Einträge gibt.</span>
            </div>
          )}
          {/* Rejecting is rare and final: folded at the very end */}
          {action("reject") && <div id="ablehnen" className="request-reject">{action("reject")}</div>}
        </div>

        <aside className="request-layout__side">
          {!hasActions && closedFor && (
            // Technician: nothing left to do, so the slot says how the request ended
            <section id="aktionen" className={`rw-card ${closedFor === "completed" ? "rw-card--success" : "rw-card--neutral"} request-next`} aria-labelledby="aktionen-title">
              <p className="request-next__eyebrow">Stand</p>
              <h2 id="aktionen-title" className="request-next__title request-next__title--done">
                {closedFor === "completed" ? "Arbeit abgeschlossen" : closedFor === "rejected" ? "Anfrage abgelehnt" : "Anfrage storniert"}
              </h2>
              <p className="rw-card__note">
                {closedFor === "completed"
                  ? <>Abgeschlossen am <span className="mono">{formatDateTime(request.completed_at)}</span>. Für Sie ist nichts mehr zu tun.</>
                  : request.rejection_reason ?? request.cancellation_reason ?? "Für Sie ist nichts mehr zu tun."}
              </p>
              {closedFor === "completed" && (
                <p className="request-next__invoice">
                  {detail.invoice
                    ? <><a className="mono" href="#rechnung">{detail.invoice.invoice_number ?? "Rechnungsentwurf"}</a><InvoiceStatusChip status={invoiceDisplayStatus(detail.invoice.status, detail.invoice.payment_due_date, berlinDayKey(new Date()))} /></>
                    : <span className="rw-card__note">Noch keine Rechnung erstellt.</span>}
                </p>
              )}
            </section>
          )}
          {!hasActions && invoiceLater && (
            // Technician: the invoice step is shown ahead, but inactive until the work is completed
            <section id="aktionen" className="rw-card rw-card--neutral request-next request-next--later" aria-labelledby="aktionen-title">
              <p className="request-next__eyebrow">Nächster Schritt</p>
              <h2 id="aktionen-title" className="request-next__title">Rechnung erstellen</h2>
              <p className="rw-card__note">Möglich, sobald die Arbeit abgeschlossen ist: Einsatz durchführen und die Anfrage abschließen.</p>
              <button type="button" className="button button--primary" disabled>Rechnungsentwurf erstellen</button>
            </section>
          )}
          {technician && hasActions && (
            <section id="aktionen" className="rw-card rw-card--action request-next" aria-labelledby="aktionen-title">
              <p className="request-next__eyebrow">Nächster Schritt</p>
              <h2 id="aktionen-title" className="sr-only">Aktionen</h2>
              <RequestActions detail={detail} employee={employee} />
            </section>
          )}
          {sections.some((item) => item.id === "kontakt") && section("kontakt", "Kontakt")}
          {!technician && (
            <section className="rw-card rw-card--meta request-card" aria-labelledby="fristen-heading">
              <h2 id="fristen-heading">Zuständigkeit und Fristen</h2>
              <Responsibility detail={detail} person={person} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

type PersonFn = (id: string | null | undefined, fallback?: string) => string;

// Which staff sections fold and what their closed line says. Open stays what the current step needs: equipment and
// intake while the intake is open. The correspondence no longer folds (task-22-1); its messages fold one by one.
function foldState(detail: RequestDetail): Partial<Record<SectionId, { open: boolean; summary: ReactNode }>> {
  const r = detail.request;
  const openIntake = ["new", "analyzing", "needs_review", "awaiting_customer"].includes(r.intake_status);
  const gaps = [r.manufacturer, r.model_type, r.machine_number].filter((value) => !value).length;
  const machine = [r.manufacturer, r.model_type].filter(Boolean).join(" ");
  const runs = detail.automationRuns ?? [];
  const analysis = [...runs].reverse().find((run) => run.step === "intake_analysis" && run.confidence !== null);
  const lastEvent = detail.events[0];
  const join = (parts: Array<ReactNode | false | null | undefined>) => parts.filter(Boolean).map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>);
  return {
    anlage: {
      open: openIntake,
      summary: join([label("equipment_kind", r.equipment_kind), machine, gaps > 0 && <span className="request-card__warn">{gaps === 1 ? "1 Angabe fehlt" : `${gaps} Angaben fehlen`}</span>]),
    },
    erstbearbeitung: {
      // The classification and status form lives here (task-22-1)
      open: openIntake,
      summary: join([
        statusInfo("intake_status", r.intake_status).label,
        r.intake_mode && label("intake_mode", r.intake_mode),
        analysis?.confidence != null && <>Konfidenz <span className="mono">{formatPercent(analysis.confidence * 100, 0)}</span></>,
        runs.length > 0 && (runs.length === 1 ? "1 Automatisierungslauf" : `${runs.length} Automatisierungsläufe`),
      ]),
    },
    verlauf: {
      open: false,
      summary: join([
        detail.events.length === 1 ? "1 Eintrag" : `${detail.events.length} Einträge`,
        lastEvent && <>zuletzt <span className="mono">{formatDateTime(lastEvent.occurred_at)}</span></>,
      ]),
    },
  };
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {items.map(([term, value]) => (
        <div key={term}><dt>{term}</dt><dd>{value === null || value === undefined || value === "" ? EMPTY : value}</dd></div>
      ))}
    </dl>
  );
}

const yesNo = (value: boolean | null | undefined, unknown = "Keine Angabe") => (value === null || value === undefined ? unknown : value ? "Ja" : "Nein");

const missing = <span className="rw-missing">nicht angegeben</span>;

function Summary({ detail }: { detail: RequestDetail }) {
  const r = detail.request;
  return (
    <>
      <blockquote className="request-quote">
        <p>{r.description}</p>
        <footer>Beschreibung des Kunden</footer>
      </blockquote>
      <Facts items={[
        ["Dringlichkeit (Kunde)", label("customer_urgency", r.customer_urgency)],
        ["Wunschtermin", r.requested_visit_date ? <span key="d" className="mono">{formatCalendarDate(r.requested_visit_date)}</span> : "Kein Wunschtermin"],
        ["Standort", r.site_label || missing],
        ...(r.completed_at ? [["Abgeschlossen", formatDateTime(r.completed_at)] as [string, ReactNode]] : []),
        ...(r.cancelled_at ? [["Storniert", `${formatDateTime(r.cancelled_at)}${r.cancellation_reason ? ` – ${r.cancellation_reason}` : ""}`] as [string, ReactNode]] : []),
        ...(r.rejection_reason ? [["Ablehnungsgrund", r.rejection_reason] as [string, ReactNode]] : []),
      ]} />
      {detail.calls.length > 0 && <PhoneCalls detail={detail} />}
    </>
  );
}

// Block "Telefonat" (task-13-7): calls of the phone assistant about this request with summary and link to the call
function PhoneCalls({ detail }: { detail: RequestDetail }) {
  const r = detail.request;
  return (
    <div className="request-calls">
      <h3 className="request-calls__title">{detail.calls.length === 1 ? "Telefonat" : "Telefonate"}</h3>
      <ul>
        {detail.calls.map((call) => (
          <li key={call.id}>
            <span>
              <Link href={`/dashboard/anrufe/${call.id}`}><span className="mono">{formatDateTime(call.started_at)}</span></Link>
              {" · "}{formatCallDuration(call.duration_seconds)}
              {call.category && <> · {label("call_category", call.category)}</>}
              {r.source_event_key === `phone_agent:${call.conversation_id}` && <> · Anfrage im Gespräch angelegt</>}
              {call.in_service_hours === false && <> · außerhalb der Servicezeit</>}
            </span>
            <span className="cell-sub">
              {call.summary ?? (call.analyzed_at ? "Keine Zusammenfassung." : "Auswertung folgt.")}
              {call.callback_needed && (call.callback_done_at ? " Rückruf erledigt." : " Rückruf offen.")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Responsibility({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const r = detail.request;
  return (
    <Facts items={[
      ["Dispatcher", r.dispatcher_id ? person(r.dispatcher_id) : <span key="d" className="rw-missing">nicht zugewiesen</span>],
      ["Techniker", r.technician_id ? person(r.technician_id) : <span key="t" className="rw-missing">nicht zugewiesen</span>],
      ["Priorität", r.priority ? statusInfo("request_priority", r.priority).label : <span key="p" className="rw-missing">noch nicht bestimmt</span>],
      ["Antwortfrist", r.response_due_at ? <span key="a" className="mono">{formatDateTime(r.response_due_at)}</span> : "nicht vereinbart"],
      ["Servicefrist", r.service_due_at ? <span key="s" className="mono">{formatDateTime(r.service_due_at)}</span> : "nicht vereinbart"],
    ]} />
  );
}

function Contact({ detail, dispatcher }: { detail: RequestDetail; dispatcher?: string }) {
  const r = detail.request;
  return (
    <>
      <p className="request-contact">
        <strong>{r.contact_name}</strong>
        <span>{r.company_name}{r.customer_number && <> · <span className="mono">{r.customer_number}</span></>}</span>
        <span>{r.street_house_number}, <span className="mono">{r.postal_code}</span> {r.city}</span>
        {r.site_label && <span>Standort: {r.site_label}</span>}
      </p>
      <p className="request-contact__actions">
        <a className="rw-button-secondary" href={`tel:${r.phone_number.replace(/[^\d+]/g, "")}`}><Icon name="phone" size={16} /><span className="mono">{r.phone_number}</span></a>
        <a className="rw-button-secondary" href={`mailto:${r.business_email}`}><Icon name="mail" size={16} />E-Mail</a>
      </p>
      <p className="rw-card__note">{r.business_email}</p>
      {dispatcher && <p className="request-contact__internal">Intern: <strong>{dispatcher}</strong> (Dispatcher)</p>}
    </>
  );
}

// Link to the customer master data (task-13-10): shows the linked customer and lets staff link, change or remove it
function CustomerLink({ detail }: { detail: RequestDetail }) {
  const r = detail.request;
  const customer = detail.customer;
  const differs = customer && (customer.company_name !== r.company_name || (customer.site && (customer.site.street_house_number !== r.street_house_number || customer.site.postal_code !== r.postal_code)));
  return (
    <div className="request-customer">
      <h3 className="request-customer__title">Kundenstamm</h3>
      {customer ? (
        <p className="rw-card__note">
          Verknüpft mit <Link href={`/dashboard/kunden/${customer.id}`}><span className="mono">{customer.customer_number}</span> {customer.company_name}</Link>
          {customer.site ? <>, Standort {customer.site.street_house_number}, {customer.site.city}</> : ", ohne Standort"}.
          {differs && <> Die Angaben der Anfrage weichen vom Kundenstamm ab.</>}
          {r.stated_customer_number && r.stated_customer_number !== customer.customer_number && <> Angegeben war <span className="mono">{r.stated_customer_number}</span>.</>}
        </p>
      ) : (
        <p className="rw-card__note">Nicht mit dem Kundenstamm verknüpft.{r.stated_customer_number && <> Angegebene Kundennummer (ungeprüft): <span className="mono">{r.stated_customer_number}</span>.</>}</p>
      )}
      {!customer && detail.customerSuggestions.length > 0 && <CustomerSuggestions request={r} suggestions={detail.customerSuggestions} />}
      {!customer && detail.customerSuggestions.length === 0 && r.intake_status !== "rejected" && r.intake_status !== "cancelled" && (
        <SaveForm action={createCustomerFromRequest} submitLabel="Neuen Kunden aus der Anfrage anlegen" submitVariant="secondary" className="request-customer__create">
          <HiddenField name="request_id" value={r.id} />
          <HiddenField name="version" value={r.version} />
          <HiddenField name="seen_at" value={r.updated_at} />
        </SaveForm>
      )}
      <details className="action">
        <summary>{customer ? "Verknüpfung ändern" : "Mit Kunden verknüpfen"}</summary>
        <SaveForm action={linkCustomer} submitLabel={customer ? "Speichern" : "Verknüpfen"}>
          <HiddenField name="request_id" value={r.id} />
          <HiddenField name="version" value={r.version} />
          <HiddenField name="seen_at" value={r.updated_at} />
          <div className="form-grid">
            <SuggestField area="kundennummer" name="customer_number" label="Kundennummer" defaultValue={customer?.customer_number ?? r.stated_customer_number ?? ""} hint="Firma, Nummer oder Ort tippen und Vorschlag wählen. Leer lassen, um die Verknüpfung zu entfernen." />
            {customer && customer.sites.length > 1 && (
              <SelectField name="site_id" label="Standort" defaultValue={customer.site?.id ?? ""} emptyLabel="Automatisch (Adresse der Anfrage)"
                options={customer.sites.map((site) => ({ value: site.id, label: `${site.street_house_number}, ${site.postal_code} ${site.city}${site.label ? ` (${site.label})` : ""}` }))} />
            )}
          </div>
          <CheckboxField name="copy_data" label="Firma, Adresse und E-Mail aus dem Kundenstamm in die Anfrage übernehmen" />
        </SaveForm>
      </details>
    </div>
  );
}

const SUGGESTION_REASON: Record<CustomerSuggestion["reason"], string> = {
  mehrere_treffer: "Mehrere passende Kunden",
  gleiche_firma: "Gleiche Firma an anderem Standort",
  gleiche_domain: "Gleiche E-Mail-Domain",
  kunde_inaktiv: "Kunde ist deaktiviert",
  nummer_passt_nicht: "Kundennummer angegeben, Daten passen nicht",
};

// Uncertain automatic match (task-14-2): staff link one of the suggested customers or create a new one
function CustomerSuggestions({ request, suggestions }: { request: RequestDetail["request"]; suggestions: CustomerSuggestion[] }) {
  return (
    <section className="customer-suggest" aria-labelledby="customer-suggest-title">
      <h4 id="customer-suggest-title" className="customer-suggest__title"><Icon name="info" size={18} />Möglicher Bestandskunde</h4>
      <p className="rw-card__note">Die automatische Zuordnung war nicht eindeutig. Bitte einen Kunden zuordnen oder einen neuen anlegen.</p>
      <ul className="customer-suggest__list">
        {suggestions.map(({ reason, customer }) => {
          const sites = customer.sites.filter((site) => site.is_active);
          return (
            <li key={customer.id} className="customer-suggest__item" data-suggestion={customer.customer_number}>
              <div className="customer-suggest__text">
                <Link href={`/dashboard/kunden/${customer.id}`}><span className="mono">{customer.customer_number}</span> {customer.company_name}</Link>
                <span className="customer-suggest__reason">{SUGGESTION_REASON[reason]}</span>
                {sites.length > 0 && (
                  <span className="cell-sub">{sites.slice(0, 3).map((site) => `${site.street_house_number}, ${site.postal_code} ${site.city}`).join(" · ")}{sites.length > 3 && ` · +${sites.length - 3}`}</span>
                )}
              </div>
              <SaveForm action={linkCustomer} submitLabel="Zuordnen" submitVariant="secondary" className="customer-suggest__action">
                <HiddenField name="request_id" value={request.id} />
                <HiddenField name="version" value={request.version} />
                <HiddenField name="seen_at" value={request.updated_at} />
                <HiddenField name="customer_number" value={customer.customer_number} />
              </SaveForm>
            </li>
          );
        })}
      </ul>
      <SaveForm action={createCustomerFromRequest} submitLabel="Neuen Kunden anlegen" submitVariant="secondary" className="customer-suggest__create">
        <HiddenField name="request_id" value={request.id} />
        <HiddenField name="version" value={request.version} />
        <HiddenField name="seen_at" value={request.updated_at} />
      </SaveForm>
    </section>
  );
}

// Held window of the phone assistant (task-13-3) or the website form (task-19-3). Since task-20-2 it is planned on the
// planning board, where it is the preselected slot; planning there closes it (also at another time).
function VisitReplyNotice({ event, requestId }: { event: RequestDetail["events"][number]; requestId: string }) {
  const cancelled = event.to_value === "cancelled";
  return (
    <section className="rw-card rw-card--attention request-next" aria-labelledby="kundenantwort-title">
      <p className="request-next__eyebrow">Kundenantwort zum Termin · {formatDateTime(event.occurred_at)}</p>
      <h2 id="kundenantwort-title" className="request-next__title">{cancelled ? "Termin auf Wunsch des Kunden storniert" : "Kunde möchte den Termin ändern – bitte prüfen"}</h2>
      {event.note && <p className="rw-card__note">{event.note}</p>}
      <p className="rw-card__note">
        {cancelled
          ? "Automatisch storniert, der Kunde hat eine Bestätigung erhalten. Die Anfrage ist wieder zu planen."
          : "Nicht automatisch geändert. E-Mail unter Korrespondenz lesen und den Termin in der Einsatzplanung anpassen."}
      </p>
      <p className="request-next__links"><a href="#korrespondenz">Zur E-Mail</a> · <Link href={`/dashboard/planung?anfrage=${requestId}`}>Zur Einsatzplanung</Link></p>
    </section>
  );
}

// "Einsatz planen" in the section "Einsätze" (task-22-1): the hold of the customer, the way to the planning board
function PlanNext({ request, hold, person }: { request: RequestDetail["request"]; hold: RequestDetail["holds"][number] | null; person: PersonFn }) {
  return (
    <div className="request-plan">
      <h3>Einsatz planen</h3>
      {hold
        ? <HoldNote hold={hold} request={request} person={person} />
        : <p className="rw-card__note">Erstbearbeitung abgeschlossen. Techniker und Termin in der Einsatzplanung wählen.</p>}
      <Link className="button button--primary" href={`/dashboard/planung?anfrage=${request.id}`}>Zur Einsatzplanung</Link>
      {hold && <HoldReject hold={hold} />}
    </div>
  );
}

function HoldNote({ hold, request, person }: { hold: RequestDetail["holds"][number]; request: RequestDetail["request"]; person: PersonFn }) {
  const payload = request.raw_payload as { request?: { preferred_time?: string } } | null;
  const wish = formatWish(request.requested_visit_date, payload?.request?.preferred_time);
  return (
    <p className="rw-card__note request-hold__line">
      Terminwunsch vorgemerkt: <span className="mono">{formatTimeRange(hold.starts_at, hold.ends_at)}</span>, {person(hold.technician_id)}.
      {hold.wish_met === false && <span className="request-hold__hint"> Gewünscht war {wish}; zu dieser Zeit war niemand frei.</span>}
    </p>
  );
}

function HoldReject({ hold }: { hold: RequestDetail["holds"][number] }) {
  return (
    <details className="action request-hold__reject">
      <summary>Terminwunsch ablehnen</summary>
      <SaveForm action={rejectHold} submitLabel="Vormerkung ablehnen" submitVariant="danger">
        <HiddenField name="hold_id" value={hold.id} />
        <TextField name="reason" label="Grund für den Kunden" required />
        <TextAreaField name="alternative" label="Gegenvorschlag" rows={2} hint="Zum Beispiel „Donnerstag ab 10 Uhr“. Steht in der E-Mail an den Kunden." />
      </SaveForm>
    </details>
  );
}

// What the contract master data says about the SLA number (task-13-9); the dispatcher still sets "SLA geprüft"
function ContractNote({ detail }: { detail: RequestDetail }) {
  const hint = contractHint(detail.contract, detail.request.postal_code, berlinDayKey(new Date()));
  return <span className="contract-note" data-state={hint.state}>{hint.text}</span>;
}

// technical: only what matters on site (no intake gaps, no SLA checks of the dispatcher)
function Equipment({ detail, technical = false }: { detail: RequestDetail; technical?: boolean }) {
  const r = detail.request;
  const gaps = [r.manufacturer, r.model_type, r.machine_number].filter((value) => !value).length;
  return (
    <>
      {gaps > 0 && !technical && <p className="rw-gaps"><Icon name="alert" size={16} />{gaps === 1 ? "1 Angabe fehlt" : `${gaps} Angaben fehlen`}</p>}
      <Facts items={[
        ["Anlagenart", label("equipment_kind", r.equipment_kind)],
        ["Leistungsart", label("service_kind", r.service_kind)],
        ["Hersteller", r.manufacturer || missing],
        ["Modell / Typ", r.model_type || missing],
        ["Maschinennummer", r.machine_number ? <span key="m" className="mono">{r.machine_number}</span> : missing],
        ["Sicherheitsgefahr", label("safety_risk", r.safety_risk)],
        ["SLA-Vertrag", r.sla_contract_number ? <span key="sla" className="mono">{r.sla_contract_number}</span> : "Keiner"],
        ...(!technical && r.sla_contract_number ? [["Vertragsbestand", <ContractNote key="contract" detail={detail} />]] as Array<[string, ReactNode]> : []),
        ...(technical ? [] : [
          ["24/7-Notfall-SLA angegeben", yesNo(r.emergency_sla_claimed)],
          ["SLA geprüft", yesNo(r.sla_verified)],
        ] as Array<[string, ReactNode]>),
      ]} />
    </>
  );
}

function Intake({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const r = detail.request;
  const runs = detail.automationRuns ?? [];
  const columns: Column<(typeof runs)[number]>[] = [
    { key: "step", header: "Schritt", cell: (run) => label("automation_step", run.step), mobile: "title" },
    { key: "status", header: "Status", cell: (run) => <StatusBadge kind="automation_status" value={run.status} /> },
    { key: "decision", header: "Entscheidung", cell: (run) => (run.decision ? label("automation_decision", run.decision) : EMPTY) },
    { key: "confidence", header: "Konfidenz", cell: (run) => (run.confidence === null ? EMPTY : formatPercent(run.confidence * 100, 0)), align: "end" },
    { key: "started", header: "Start", cell: (run) => formatDateTime(run.started_at) },
    { key: "correction", header: "Korrektur", cell: (run) => (run.corrected_at ? `${person(run.corrected_by, "Unbekannt")}: ${run.correction_reason ?? ""}` : EMPTY) },
  ];
  return (
    <>
      <Facts items={[
        ["Status", <StatusBadge key="s" kind="intake_status" value={r.intake_status} />],
        ["Bearbeitungsart", r.intake_mode ? label("intake_mode", r.intake_mode) : "Noch offen"],
        ["Abgeschlossen am", formatDateTime(r.intake_completed_at)],
        ["Basiswert manuelle Bearbeitung", r.manual_minutes_baseline === null ? null : formatMinutes(r.manual_minutes_baseline)],
        ["Erste inhaltliche Antwort", formatDateTime(r.first_substantive_response_at)],
        ["Menschliche Prüfung erforderlich", yesNo(r.human_review_required)],
      ]} />
      <h3>Automatisierungsläufe</h3>
      <DataTable caption="Automatisierungsläufe" columns={columns} rows={runs} rowKey={(run) => run.id} empty={<EmptyState title="Keine Automatisierungsläufe." />} />
    </>
  );
}

// First words of an e-mail for the banner of unread messages
const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
};

const MESSAGE_KIND_LABELS: Record<string, string> = { receipt: "Eingangsbestätigung", clarification: "Rückfrage", customer_reply: "Kundenantwort", invoice: "Rechnung", payment_reminder: "Zahlungserinnerung", other: "Sonstige" };

function Correspondence({ detail, person, editable }: { detail: RequestDetail; person: PersonFn; editable: boolean }) {
  const messages = detail.messages ?? [];
  if (messages.length === 0) return <EmptyState title="Keine Nachrichten zu dieser Anfrage." />;
  // Drafts of the reply assistant (task-22-3) with the reason the model gave for the person who sends them
  const assisted = new Map((detail.automationRuns ?? []).filter((run) => run.step === "reply_assist").flatMap((run) => {
    const result = run.result as { draft_id?: string | null; reason?: string } | null;
    return result?.draft_id ? [[result.draft_id, result.reason ?? ""] as const] : [];
  }));
  return (
    <>
      <p className="section-note">„Senden“ übergibt die E-Mail an die Versand-Integration. „In Warteschlange“ heißt noch nicht versendet; „Versand bestätigt“ meldet die Integration.</p>
      <ul className="message-list">
        {messages.map((message) => {
          const incoming = message.direction === "incoming";
          const unread = isUnreadMessage(message, detail.request.created_at);
          const when = message.received_at ?? message.sent_at ?? message.created_at;
          return (
            // Anchor for "Als Entwurf speichern" (task-20-8): the page opens at the new draft, :target marks it
            <li key={message.id} id={`nachricht-${message.id}`} className={`message message--${message.direction}${unread ? " message--unread" : ""}`}>
              <details open={(message.status === "draft" && editable) || unread}>
                <summary>
                  <span className="message__head">
                    <span className="message__direction">{incoming ? "Eingehend" : "Ausgehend"} · {MESSAGE_KIND_LABELS[message.kind] ?? message.kind}</span>
                    {unread && <span className="message__new">Neu · ungelesen</span>}
                    {assisted.has(message.id) && <span className="message__assist">KI-Entwurf</span>}
                    <StatusBadge kind="message_status" value={message.status} />
                  </span>
                  <strong>{message.subject}</strong>
                  <span className="message__meta">{incoming ? `Von ${message.from_address ?? EMPTY}` : `An ${message.to_address ?? EMPTY}`} · {formatDateTime(when)}</span>
                </summary>
                <div className="message__body">
                  <p>{message.body_text}</p>
                  {message.author_id && <p className="message__meta">Verfasst von {person(message.author_id, "Unbekannt")}</p>}
                  {message.error_text && <p className="message__error">Fehler: {message.error_text}</p>}
                  {message.status === "draft" && editable && <>
                    {assisted.has(message.id) && (
                      <p className="message__assist-note"><strong>Entwurf des Antwortassistenten.</strong> {assisted.get(message.id)} Bitte Fakten prüfen, bei Bedarf anpassen und erst dann senden.</p>
                    )}
                    <p className="message__draft-note">Entwurf gespeichert, noch nicht versendet. Hier bearbeiten, senden oder löschen.</p>
                    <DraftActions detail={detail} message={message} />
                  </>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Visits({ detail, person, employee }: { detail: RequestDetail; person: PersonFn; employee: { id: string; role: string } }) {
  // Visit workspace for the planned technician, managers and admins (task-6-2)
  const canOpen = (visit: RequestDetail["visits"][number]) => visit.status !== "cancelled" && (employee.role === "manager" || employee.role === "admin" || (employee.role === "technician" && visit.technician_id === employee.id));
  const columns: Column<RequestDetail["visits"][number]>[] = [
    { key: "time", header: "Termin", cell: (visit) => formatTimeRange(visit.scheduled_start, visit.scheduled_end), mobile: "title" },
    { key: "technician", header: "Techniker", cell: (visit) => person(visit.technician_id) },
    { key: "status", header: "Status", cell: (visit) => <StatusBadge kind="visit_status" value={visit.status} /> },
    { key: "actual", header: "Tatsächlich", cell: (visit) => (visit.actual_start ? `${formatDateTime(visit.actual_start)}${visit.actual_end ? ` – ${formatDateTime(visit.actual_end)}` : ""}` : EMPTY), mobile: "hide" },
    { key: "minutes", header: "Arbeitszeit", cell: (visit) => (visit.actual_work_minutes === null ? EMPTY : formatMinutes(visit.actual_work_minutes)), align: "end" },
    { key: "note", header: "Bemerkung", cell: (visit) => visit.summary ?? visit.waiting_reason ?? visit.cancellation_reason ?? EMPTY },
    { key: "open", header: "Einsatz", cell: (visit) => (canOpen(visit) ? <Link className="rw-nowrap" href={`/dashboard/einsatz/${visit.id}`}>Öffnen</Link> : EMPTY) },
  ];
  return <DataTable caption="Einsätze" columns={columns} rows={detail.visits} rowKey={(visit) => visit.id} empty={<EmptyState title="Noch kein Einsatz geplant." />} />;
}

function Work({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const entries = detail.workEntries;
  const active = entries.filter((entry) => entry.item_status !== "cancelled");
  const net = active.reduce((sum, entry) => sum + Math.round(entry.quantity * entry.unit_price * 100) / 100, 0);
  const columns: Column<(typeof entries)[number]>[] = [
    { key: "description", header: "Position", cell: (entry) => entry.description, mobile: "title" },
    { key: "kind", header: "Art", cell: (entry) => <span className="rw-nowrap">{label("work_entry_kind", entry.kind)}</span> },
    { key: "quantity", header: "Menge", cell: (entry) => `${formatNumber(entry.quantity, entry.unit === "hour" ? 2 : 0)} ${label("work_unit", entry.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (entry) => formatCurrency(entry.unit_price), align: "end" },
    { key: "status", header: "Status", cell: (entry) => <StatusBadge kind="work_item_status" value={entry.item_status} /> },
    { key: "billable", header: "Abrechenbar", cell: (entry) => (entry.billable ? "Ja" : "Nein"), mobile: "hide" },
    { key: "author", header: "Erfasst von", cell: (entry) => person(entry.author_id, "Unbekannt"), mobile: "hide" },
  ];
  return (
    <>
      {detail.request.completion_summary && (
        <div className="text-block">
          <h3>Abschlussbericht</h3>
          <p>{detail.request.completion_summary}</p>
        </div>
      )}
      <DataTable caption="Arbeitspositionen" columns={columns} rows={entries} rowKey={(entry) => entry.id} empty={<EmptyState title="Noch keine Arbeitspositionen erfasst." />} />
      {active.length > 0 && <p className="section-note">Summe netto ohne stornierte Positionen: <strong>{formatCurrency(net)}</strong></p>}
    </>
  );
}

const FILE_TYPES: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "Bild (JPEG)", "image/png": "Bild (PNG)" };

function Documents({ detail, person }: { detail: RequestDetail; person: PersonFn }) {
  const columns: Column<RequestDetail["attachments"][number]>[] = [
    { key: "name", header: "Datei", cell: (file) => <a href={`/dashboard/anfragen/${detail.request.id}/dokumente/${file.id}`} target="_blank" rel="noopener">{file.file_name}</a>, mobile: "title" },
    { key: "type", header: "Typ", cell: (file) => FILE_TYPES[file.mime_type] ?? file.mime_type },
    { key: "size", header: "Größe", cell: (file) => `${formatNumber(file.size_bytes / 1024, 0)} KB`, align: "end" },
    { key: "visibility", header: "Sichtbar für", cell: (file) => label("visibility_level", file.visibility) },
    { key: "by", header: "Hochgeladen", cell: (file) => `${formatDateTime(file.created_at)}${file.uploaded_by ? ` · ${person(file.uploaded_by, "Unbekannt")}` : ""}`, mobile: "hide" },
  ];
  return <DataTable caption="Dokumente" columns={columns} rows={detail.attachments} rowKey={(file) => file.id} empty={<EmptyState title="Keine Dokumente sichtbar." />} />;
}

function Invoice({ detail, canPay }: { detail: RequestDetail; canPay: boolean }) {
  const invoice = detail.invoice;
  if (!invoice) return <EmptyState title="Noch keine Rechnung." />;
  const today = berlinDayKey(new Date());
  const shown = invoiceDisplayStatus(invoice.status, invoice.payment_due_date, today);
  const columns: Column<RequestDetail["invoiceItems"][number]>[] = [
    { key: "position", header: "Pos.", cell: (item) => item.position, mobile: "hide" },
    { key: "description", header: "Beschreibung", cell: (item) => item.description, mobile: "title" },
    { key: "quantity", header: "Menge", cell: (item) => `${formatNumber(item.quantity, item.unit === "hour" ? 2 : 0)} ${label("work_unit", item.unit)}`, align: "end" },
    { key: "price", header: "Einzelpreis", cell: (item) => formatCurrency(item.unit_price), align: "end" },
    { key: "tax", header: "USt.", cell: (item) => formatPercent(item.tax_rate, 0), align: "end" },
    { key: "net", header: "Netto", cell: (item) => formatCurrency(item.net_amount), align: "end" },
  ];
  return (
    <>
      {invoice.status === "draft" && <p className="section-note">Entwurf: Positionen und Beträge sind eine Vorschau und werden bei der Ausstellung neu berechnet. Das PDF gibt es erst nach der Ausstellung.</p>}
      {invoice.status !== "draft" && invoice.invoice_number && (
        <p className="invoice-download">
          <a className="button button--secondary" href={`/dashboard/anfragen/${detail.request.id}/rechnung/pdf`} download>PDF herunterladen</a>
          <span className="section-note">Musterrechnung / Demodaten · {invoice.invoice_number}</span>
        </p>
      )}
      <Facts items={[
        ["Status", <InvoiceStatusChip key="s" status={shown} />],
        ["Rechnungsnummer", invoice.invoice_number ? <span key="n" className="mono">{invoice.invoice_number}</span> : "Wird bei Ausstellung vergeben"],
        ["Rechnungsdatum", formatCalendarDate(invoice.issue_date)],
        ["Fällig am", formatCalendarDate(invoice.payment_due_date)],
        ["Als versendet markiert", formatDateTime(invoice.sent_at)],
        ["Bezahlt am", formatDateTime(invoice.paid_at)],
        ...(invoice.status !== "draft" ? [
          ["Mahnstufe", stageLabel(detail.reminderState?.last_stage)] as [string, ReactNode],
          ["Nächste Erinnerung", nextReminderText(detail.reminderState, today) ?? "Keine weitere"] as [string, ReactNode],
        ] : []),
      ]} />
      <DataTable caption="Rechnungspositionen" columns={columns} rows={detail.invoiceItems} rowKey={(item) => item.id} empty={<EmptyState title="Keine Positionen." />} />
      <dl className="totals">
        <div><dt>Netto</dt><dd>{formatCurrency(invoice.subtotal, invoice.currency)}</dd></div>
        <div><dt>Umsatzsteuer</dt><dd>{formatCurrency(invoice.tax_total, invoice.currency)}</dd></div>
        <div className="totals__sum"><dt>Gesamt</dt><dd>{formatCurrency(invoice.total, invoice.currency)}</dd></div>
      </dl>
      <p className="section-note">Musterrechnung mit Demodaten, nicht rechtsverbindlich.</p>
      <PaymentReminders detail={detail} canManage={canPay} today={today} />
      {canPay && (invoice.status === "issued" || invoice.status === "sent") && (
        <details className="action" id="zahlung">
          <summary>Zahlung erfassen</summary>
          <PaymentForm requestId={detail.request.id} version={detail.request.version} invoiceId={invoice.id} today={today} />
        </details>
      )}
    </>
  );
}

const ACTOR_LABELS = { automation: "Automatisierung", system: "System" } as const;

function History({ detail, names, folded = false }: { detail: RequestDetail; names: Map<string, string>; folded?: boolean }) {
  if (detail.events.length === 0) return <EmptyState title="Keine Ereignisse sichtbar." />;
  const item = (event: RequestDetail["events"][number]) => {
    const { title, change } = describeEvent(event, names);
    const actor = event.actor_type === "user" ? names.get(event.actor_id ?? "") ?? "Unbekannte Person" : ACTOR_LABELS[event.actor_type];
    return (
      <li key={event.id}>
        <time className="mono" dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
        <div>
          <strong>{title}</strong>
          {change && <span className="timeline__change">{change}</span>}
          {event.note && <span className="timeline__note">{event.note}</span>}
          <span className="timeline__actor">{actor}</span>
        </div>
      </li>
    );
  };
  if (folded) {
    return (
      <details className="rw-more">
        <summary>{detail.events.length === 1 ? "1 Eintrag anzeigen" : `${detail.events.length} Einträge anzeigen`}</summary>
        <ol className="timeline">{detail.events.map(item)}</ol>
      </details>
    );
  }
  const first = detail.events.slice(0, 5);
  const rest = detail.events.slice(5);
  return (
    <>
      <ol className="timeline">{first.map(item)}</ol>
      {rest.length > 0 && (
        <details className="rw-more">
          <summary>Alle {detail.events.length} Einträge anzeigen</summary>
          <ol className="timeline" start={6}>{rest.map(item)}</ol>
        </details>
      )}
    </>
  );
}

type Visit = RequestDetail["visits"][number];

// The technician's own visit to show on top: the next open one, otherwise the most recent
function ownNextVisit(visits: Visit[], technicianId: string): Visit | undefined {
  const own = visits.filter((visit) => visit.technician_id === technicianId && visit.status !== "cancelled");
  const open = own.filter((visit) => visit.status !== "completed").sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  return open[0] ?? own.sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start))[0];
}

function VisitHero({ visit, request }: { visit: Visit | undefined; request: RequestDetail["request"] }) {
  if (!visit) {
    return (
      <section className="rw-card rw-card--neutral request-visit" aria-labelledby="visit-title">
        <h2 id="visit-title" className="request-next__eyebrow">Ihr Einsatz</h2>
        <p>Für Sie ist bei dieser Anfrage kein Einsatz geplant.</p>
      </section>
    );
  }
  const done = visit.status === "completed";
  return (
    <section className={`rw-card ${done ? "rw-card--neutral" : "rw-card--action"} request-visit`} aria-labelledby="visit-title">
      <p className="request-next__eyebrow">{done ? "Ihr letzter Einsatz" : "Ihr Einsatz"}</p>
      <div className="request-visit__row">
        <div className="request-visit__when">
          <h2 id="visit-title">{formatTimeRange(visit.scheduled_start, visit.scheduled_end)}</h2>
          <StatusBadge kind="visit_status" value={visit.status} />
          {visit.waiting_reason && <p className="rw-card__note">{visit.waiting_reason}</p>}
        </div>
        <address className="request-visit__where">
          <span>{request.street_house_number}</span>
          <span><span className="mono">{request.postal_code}</span> {request.city}</span>
          {request.site_label && <span>Standort: {request.site_label}</span>}
        </address>
        <Link className={`button ${done ? "button--secondary" : "button--primary"} request-visit__open`} href={`/dashboard/einsatz/${visit.id}`}>
          {done ? "Einsatz ansehen" : "Einsatz öffnen"}
        </Link>
      </div>
    </section>
  );
}
