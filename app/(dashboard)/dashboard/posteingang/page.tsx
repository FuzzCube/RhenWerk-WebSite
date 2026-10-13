import type { Metadata } from "next";
import Link from "next/link";
import { createRequestFromMessage, linkMessage } from "@/app/(dashboard)/dashboard/posteingang/actions";
import { SaveForm, SelectField, TextAreaField, TextField, HiddenField } from "@/components/dashboard/ui/save-form";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { addDays } from "@/lib/berlin-time";
import { getInboxMessage, linkCandidates, listInbox, listLinked, type InboxMessage } from "@/lib/dashboard/inbox";
import { berlinDayKey, formatDateTime, formatNumber } from "@/lib/format";
import { LABELS, label } from "@/lib/status";

export const metadata: Metadata = { title: "Posteingang" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type View = "offen" | "zugeordnet";

const BASE = "/dashboard/posteingang";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const options = (kind: keyof typeof LABELS) => Object.entries(LABELS[kind]).map(([value, text]) => ({ value, label: text }));
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Inbox of unmatched incoming e-mails (task-10-5): e-mails without request number or thread land in a dispatcher's
// inbox. Dispatchers see their own inbox, manager and admin all. Each e-mail is assigned to an existing request
// (link_message) or becomes a new request; both are logged on the request.
export default async function InboxPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor(BASE));
  const params = await searchParams;
  const view: View = one(params.ansicht) === "zugeordnet" ? "zugeordnet" : "offen";
  const [inbox, linked] = await Promise.all([listInbox(), listLinked()]);
  const allInboxes = employee.role !== "dispatcher";

  const requested = one(params.nachricht);
  const selectedId = view === "offen" ? (UUID.test(requested) ? requested : inbox.rows[0]?.id) : undefined;
  const selected = selectedId ? await getInboxMessage(selectedId) : null;
  const term = one(params.suche);
  const candidates = selected && !selected.request ? await linkCandidates(selected.from_address, term) : [];
  const href = (next: Record<string, string>) => `${BASE}?${new URLSearchParams(next).toString()}`;

  return (
    <div className="dash-page rw-page rw-page--tight side-page inbox-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="inbox-title" className="side-page__title">
            {view === "offen" ? "Offene E-Mails" : "Zuletzt zugeordnet"}
            <span className="side-page__count mono">{formatNumber(view === "offen" ? inbox.rows.length : linked.rows.length)}</span>
          </h1>
          <p className="side-page__desc">
            {view === "offen"
              ? "E-Mails ohne Anfragenummer und ohne bekannten Verlauf. Einer bestehenden Anfrage zuordnen oder daraus eine neue Anfrage anlegen."
              : "Aus dem Posteingang zugeordnete E-Mails der letzten 14 Tage."}
          </p>
        </div>
      </header>

      <div className="side-page__grid">
        <SideMenu
          label="Ansichten"
          title="Posteingang"
          scope={[allInboxes ? "Alle Posteingänge" : "Ihr Posteingang", "Nichts wird automatisch beantwortet."]}
          groups={[{
            title: "E-Mails",
            items: [
              { key: "offen", label: "Offen", href: BASE, active: view === "offen", count: inbox.error ? null : inbox.rows.length, actionable: true },
              { key: "zugeordnet", label: "Zuletzt zugeordnet", href: href({ ansicht: "zugeordnet" }), active: view === "zugeordnet", count: linked.error ? null : linked.rows.length },
            ],
          }]}
        />

        <section className="side-page__main" aria-labelledby="inbox-title">
          {view === "zugeordnet" ? (
            linked.error ? <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState> : (
              <div className="side-page__list">
                <div className="side-page__list-bar"><p className="result-count"><strong>{formatNumber(linked.rows.length)} zugeordnet</strong> · letzte 14 Tage</p></div>
                {linked.rows.length === 0 ? <EmptyState title="In den letzten 14 Tagen wurde nichts zugeordnet." /> : (
                  <ul className="inbox-list">
                    {linked.rows.map((row) => (
                      <li key={`${row.message_id}-${row.linked_at}`}>
                        <Link className="inbox-item" href={`/dashboard/anfragen/${row.request_id}#korrespondenz-title`}>
                          <span className="inbox-item__top"><strong>{row.subject || "(ohne Betreff)"}</strong><span className="mono">{formatDateTime(row.linked_at)}</span></span>
                          <span className="inbox-item__meta"><span className="mono">{row.request_number}</span> · {row.company_name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          ) : inbox.error ? (
            <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
          ) : inbox.rows.length === 0 && !selected ? (
            <div className="side-page__list"><EmptyState tone="good" title="Keine offenen E-Mails">Neue E-Mails ohne Anfragenummer erscheinen hier.</EmptyState></div>
          ) : (
            <div className="inbox">
              <div className="side-page__list inbox__list">
                <div className="side-page__list-bar"><p className="result-count" role="status"><strong>{formatNumber(inbox.rows.length)} {inbox.rows.length === 1 ? "E-Mail" : "E-Mails"}</strong> · neueste zuerst</p></div>
                <ul className="inbox-list">
                  {inbox.rows.map((row) => (
                    <li key={row.id}>
                      <Link className="inbox-item" href={`${href({ nachricht: row.id })}#nachricht`} aria-current={row.id === selected?.id ? "true" : undefined} scroll={false}>
                        <span className="inbox-item__top"><strong className="inbox-item__from">{row.from_address}</strong><span className="mono">{row.received_at ? formatDateTime(row.received_at) : "–"}</span></span>
                        <span className="inbox-item__subject">{row.subject || "(ohne Betreff)"}</span>
                        <span className="inbox-item__meta">
                          {row.attachments > 0 && <><Icon name="document" size={14} />{formatNumber(row.attachments)} · </>}
                          {allInboxes && row.inbox_dispatcher_id ? <>Posteingang {inbox.names.get(row.inbox_dispatcher_id) ?? "–"} · </> : null}
                          {row.excerpt}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              {selected ? <MessageView message={selected} candidates={candidates} term={term} owner={allInboxes && selected.inbox_dispatcher_id ? inbox.names.get(selected.inbox_dispatcher_id) ?? null : null} /> : (
                <div className="side-page__list"><EmptyState title="E-Mail nicht gefunden oder bereits zugeordnet." action={<Link className="rw-button-secondary" href={BASE}>Zum Posteingang</Link>} /></div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageView({ message, candidates, term, owner }: { message: InboxMessage; candidates: Awaited<ReturnType<typeof linkCandidates>>; term: string; owner: string | null }) {
  const today = berlinDayKey(new Date());
  return (
    <article className="rw-card rw-card--list rw-card--flush rw-card--neutral inbox-mail" id="nachricht" aria-labelledby="mail-title">
      <header className="rw-card__header inbox-mail__head">
        <div className="rw-card__heading">
          <div>
            <h2 id="mail-title" className="rw-card__title">{message.subject || "(ohne Betreff)"}</h2>
            <p className="rw-card__description rw-card__note">
              Von <strong>{message.from_address}</strong> · <span className="mono">{message.received_at ? formatDateTime(message.received_at) : "–"}</span>{owner && <> · Posteingang {owner}</>}
            </p>
          </div>
        </div>
      </header>
      <div className="rw-card--list__pad">
        <div className="inbox-mail__body">{message.body_text}</div>
        {message.files.length > 0 && (
          <ul className="inbox-mail__files" aria-label="Anhänge">
            {message.files.map((file) => (
              <li key={file.id}><a href={`/dashboard/posteingang/dateien/${file.id}`} target="_blank" rel="noreferrer"><Icon name="document" size={16} />{file.file_name}</a></li>
            ))}
          </ul>
        )}

        {message.request ? (
          <p className="notice" role="status">
            Zugeordnet zu <Link href={`/dashboard/anfragen/${message.request.id}#korrespondenz-title`}><span className="mono">{message.request.request_number}</span> · {message.request.company_name}</Link>.
          </p>
        ) : (
          <div className="inbox-mail__actions">
            <details className="action" open>
              <summary>Einer Anfrage zuordnen</summary>
              <div className="inbox-mail__action-body">
                <form className="inbox-search" method="get" action="/dashboard/posteingang" role="search" aria-label="Anfrage suchen">
                  <input type="hidden" name="nachricht" value={message.id} />
                  <label className="sr-only" htmlFor="inbox-suche">Anfrage suchen</label>
                  <input id="inbox-suche" className="rw-input" name="suche" type="search" defaultValue={term} placeholder="Anfragenummer, Firma oder E-Mail" />
                  <button className="rw-button-secondary" type="submit">Suchen</button>
                </form>
                {candidates.length === 0 ? (
                  <p className="rw-card__note">{term ? "Keine passende Anfrage gefunden." : "Keine Anfrage mit dieser Absenderadresse. Nach Nummer, Firma oder E-Mail suchen."}</p>
                ) : (
                  <SaveForm action={linkMessage} submitLabel="Zuordnen">
                    <HiddenField name="message_id" value={message.id} />
                    <SelectField
                      name="target"
                      label="Anfrage"
                      required
                      defaultValue={candidates.length === 1 ? `${candidates[0].id}:${candidates[0].version}` : undefined}
                      options={candidates.map((row) => ({ value: `${row.id}:${row.version}`, label: `${row.request_number ?? "ohne Nummer"} · ${row.company_name} · ${row.city} · ${formatDateTime(row.created_at).slice(0, 10)}` }))}
                    />
                  </SaveForm>
                )}
              </div>
            </details>
            <details className="action">
              <summary>Neue Anfrage anlegen</summary>
              <div className="inbox-mail__action-body">
                <p className="rw-card__note">Vorbelegt aus der E-Mail. Es wird keine Eingangsbestätigung versendet; die Anfrage geht wie jede neue Anfrage in die Erstbearbeitung.</p>
                <SaveForm action={createRequestFromMessage} submitLabel="Anfrage anlegen">
                  <HiddenField name="message_id" value={message.id} />
                  <div className="form-grid">
                    <TextField name="company_name" label="Firma" required />
                    <TextField name="contact_name" label="Ansprechperson" required />
                    <TextField name="business_email" label="E-Mail-Adresse" type="email" required defaultValue={message.from_address ?? ""} />
                    <TextField name="phone_number" label="Telefon" type="tel" required />
                    <TextField name="street_house_number" label="Straße und Hausnummer" required />
                    <TextField name="postal_code" label="PLZ" inputMode="numeric" required />
                    <TextField name="city" label="Ort" required />
                    <TextField name="customer_number" label="Kundennummer" />
                    <SelectField name="equipment_kind" label="Anlagenart" required options={options("equipment_kind")} />
                    <TextField name="manufacturer" label="Hersteller" />
                    <TextField name="model_type" label="Modell / Typ" />
                    <SelectField name="service_kind" label="Leistungsart" required options={options("service_kind")} />
                    <TextField name="requested_visit_date" label="Wunschtermin" type="date" required defaultValue={addDays(today, 7)} />
                    <SelectField name="customer_urgency" label="Dringlichkeit" required defaultValue="planbar" options={options("customer_urgency")} />
                    <SelectField name="safety_risk" label="Sicherheitsgefahr" required options={options("safety_risk")} hint={`Bei „${label("safety_risk", "known")}“ oder „${label("safety_risk", "unclear")}“ ist eine Prüfung erforderlich.`} />
                  </div>
                  <TextAreaField name="description" label="Beschreibung" required rows={6} defaultValue={`${message.subject}\n\n${message.body_text}`.trim().slice(0, 2000)} />
                </SaveForm>
              </div>
            </details>
          </div>
        )}
      </div>
    </article>
  );
}
