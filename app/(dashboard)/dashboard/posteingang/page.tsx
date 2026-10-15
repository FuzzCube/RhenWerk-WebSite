import type { Metadata } from "next";
import Link from "next/link";
import { archiveMessage, createRequestFromMessage, linkMessage, restoreMessage } from "@/app/(dashboard)/dashboard/posteingang/actions";
import { RequestFields } from "@/components/dashboard/request-fields";
import { SaveForm, SelectField, HiddenField } from "@/components/dashboard/ui/save-form";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { addDays } from "@/lib/berlin-time";
import { getInboxMessage, linkCandidates, listArchived, listInbox, listLinked, type ArchivedItem, type ArchiveReason, type InboxMessage } from "@/lib/dashboard/inbox";
import { extractRequestFields, type ExtractedField } from "@/lib/inbox-extract";
import { berlinDayKey, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Posteingang" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type View = "offen" | "zugeordnet" | "archiv";

const BASE = "/dashboard/posteingang";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const ARCHIVE_REASONS: Record<ArchiveReason, string> = {
  advertising: "Werbung oder Newsletter",
  supplier: "Lieferant oder Dienstleister",
  application: "Bewerbung",
  other: "Sonstiges, kein Auftrag",
};
const DESCRIPTIONS: Record<View, string> = {
  offen: "E-Mails ohne Anfragenummer und ohne bekannten Verlauf. Einer bestehenden Anfrage zuordnen, daraus eine neue Anfrage anlegen oder archivieren, wenn sie keinen Auftrag betrifft.",
  zugeordnet: "Aus dem Posteingang zugeordnete E-Mails der letzten 14 Tage.",
  archiv: "E-Mails ohne Auftragsbezug (Werbung, Lieferanten, Bewerbungen). Nichts wird gelöscht; wiederhergestellte E-Mails stehen wieder unter „Offen“.",
};

// Inbox of unmatched incoming e-mails (task-10-5): e-mails without request number or thread land in a dispatcher's
// inbox. Dispatchers see their own inbox, manager and admin all. Each e-mail is assigned to an existing request
// (link_message) or becomes a new request; both are logged on the request.
export default async function InboxPage({ searchParams }: Props) {
  const employee = await requireRole(rolesFor(BASE));
  const params = await searchParams;
  const view: View = one(params.ansicht) === "zugeordnet" ? "zugeordnet" : one(params.ansicht) === "archiv" ? "archiv" : "offen";
  const [inbox, linked, archived] = await Promise.all([listInbox(), listLinked(), listArchived()]);
  const allInboxes = employee.role !== "dispatcher";

  const requested = one(params.nachricht);
  const list = view === "archiv" ? archived : inbox;
  const selectedId = view === "zugeordnet" ? undefined : UUID.test(requested) ? requested : list.rows[0]?.id;
  const selected = selectedId ? await getInboxMessage(selectedId) : null;
  const term = one(params.suche);
  const candidates = selected && !selected.request && !selected.archived ? await linkCandidates(selected.from_address, term) : [];
  // Just archived (undo offered once on the next page)
  const justArchived = view === "offen" && UUID.test(one(params.archiviert)) ? archived.rows.find((row) => row.id === one(params.archiviert)) ?? null : null;
  const names = new Map([...inbox.names, ...archived.names]);
  const href = (next: Record<string, string>) => `${BASE}?${new URLSearchParams(next).toString()}`;

  return (
    <div className="dash-page rw-page rw-page--tight side-page inbox-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="inbox-title" className="side-page__title">
            {view === "offen" ? "Offene E-Mails" : view === "archiv" ? "Archiv" : "Zuletzt zugeordnet"}
            <span className="side-page__count mono">{formatNumber(view === "offen" ? inbox.rows.length : view === "archiv" ? archived.rows.length : linked.rows.length)}</span>
          </h1>
          <p className="side-page__desc">{DESCRIPTIONS[view]}</p>
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
              { key: "archiv", label: "Archiv", href: href({ ansicht: "archiv" }), active: view === "archiv", count: archived.error ? null : archived.rows.length },
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
          ) : list.error ? (
            <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
          ) : (
            <>
              {justArchived && (
                <div className="notice inbox-undo" role="status">
                  <span>Archiviert: <strong>{justArchived.subject || "(ohne Betreff)"}</strong> · {ARCHIVE_REASONS[justArchived.archive_reason]}</span>
                  <SaveForm action={restoreMessage} submitLabel="Rückgängig" submitVariant="secondary" className="inbox-undo__form">
                    <HiddenField name="message_id" value={justArchived.id} />
                  </SaveForm>
                </div>
              )}
              {list.rows.length === 0 && !selected ? (
                <div className="side-page__list">
                  {view === "archiv"
                    ? <EmptyState title="Keine archivierten E-Mails" />
                    : <EmptyState tone="good" title="Keine offenen E-Mails">Neue E-Mails ohne Anfragenummer erscheinen hier.</EmptyState>}
                </div>
              ) : (
                <div className="inbox">
                  <div className="side-page__list inbox__list">
                    <div className="side-page__list-bar"><p className="result-count" role="status"><strong>{formatNumber(list.rows.length)} {list.rows.length === 1 ? "E-Mail" : "E-Mails"}</strong> · {view === "archiv" ? "zuletzt archiviert zuerst" : "neueste zuerst"}</p></div>
                    <ul className="inbox-list">
                      {list.rows.map((row) => (
                        <li key={row.id}>
                          <Link className="inbox-item" href={`${href(view === "archiv" ? { ansicht: "archiv", nachricht: row.id } : { nachricht: row.id })}#nachricht`} aria-current={row.id === selected?.id ? "true" : undefined} scroll={false}>
                            <span className="inbox-item__top"><strong className="inbox-item__from">{row.from_address}</strong><span className="mono">{row.received_at ? formatDateTime(row.received_at) : "–"}</span></span>
                            <span className="inbox-item__subject">{row.subject || "(ohne Betreff)"}</span>
                            <span className="inbox-item__meta">
                              {view === "archiv" && <span className="rw-flag rw-flag--neutral">{ARCHIVE_REASONS[(row as ArchivedItem).archive_reason]}</span>}
                              {row.attachments > 0 && <><Icon name="document" size={14} />{formatNumber(row.attachments)} · </>}
                              {allInboxes && row.inbox_dispatcher_id ? <>Posteingang {names.get(row.inbox_dispatcher_id) ?? "–"} · </> : null}
                              {row.excerpt}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selected ? <MessageView message={selected} candidates={candidates} term={term} names={names} owner={allInboxes && selected.inbox_dispatcher_id ? names.get(selected.inbox_dispatcher_id) ?? null : null} /> : (
                    <div className="side-page__list"><EmptyState title="E-Mail nicht gefunden oder bereits zugeordnet." action={<Link className="rw-button-secondary" href={BASE}>Zum Posteingang</Link>} /></div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const MATCH_LABEL = { sender: "gleiche Absenderadresse", domain: "gleiche Firmendomain", search: "Suche" } as const;

function MessageView({ message, candidates, term, owner, names }: { message: InboxMessage; candidates: Awaited<ReturnType<typeof linkCandidates>>; term: string; owner: string | null; names: Map<string, string> }) {
  const today = berlinDayKey(new Date());
  // Rule-based prefill (task-10-10); recognised fields carry a hint so they are checked before saving
  const found = message.request || message.archived ? {} : extractRequestFields({ subject: message.subject, body: message.body_text, fromAddress: message.from_address, today });
  const recognised = Object.keys(found).length;
  const hint = (field: ExtractedField) => (found[field] ? "Aus der E-Mail erkannt – bitte prüfen." : undefined);
  const search = term || message.from_address || "";
  // Preselect the request of the same sender when it is the only one (domain matches may add more)
  const senderMatches = candidates.filter((row) => row.match === "sender");
  const preselected = senderMatches.length === 1 ? senderMatches[0] : candidates.length === 1 ? candidates[0] : null;
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

        {message.archived ? (
          <div className="notice inbox-undo" role="status">
            <span>Archiviert am <span className="mono">{formatDateTime(message.archived.at)}</span>{message.archived.by && <> von {names.get(message.archived.by) ?? "–"}</>} · {ARCHIVE_REASONS[message.archived.reason]}</span>
            <SaveForm action={restoreMessage} submitLabel="Wiederherstellen" submitVariant="secondary" className="inbox-undo__form">
              <HiddenField name="message_id" value={message.id} />
            </SaveForm>
          </div>
        ) : message.request ? (
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
                  <input id="inbox-suche" className="rw-input" name="suche" type="search" defaultValue={search} placeholder="Anfragenummer, Firma oder E-Mail" />
                  <button className="rw-button-secondary" type="submit">Suchen</button>
                </form>
                {candidates.length === 0 ? (
                  <p className="rw-card__note">{term ? "Keine passende Anfrage gefunden." : "Keine Anfrage mit dieser Absenderadresse oder Firmendomain. Suche anpassen (Nummer, Firma oder E-Mail) und „Suchen“ drücken."}</p>
                ) : (
                  <SaveForm action={linkMessage} submitLabel="Zuordnen">
                    <HiddenField name="message_id" value={message.id} />
                    <SelectField
                      name="target"
                      label="Anfrage"
                      required
                      defaultValue={preselected ? `${preselected.id}:${preselected.version}` : undefined}
                      options={candidates.map((row) => ({ value: `${row.id}:${row.version}`, label: `${row.request_number ?? "ohne Nummer"} · ${row.company_name} · ${row.city} · ${formatDateTime(row.created_at).slice(0, 10)} · ${MATCH_LABEL[row.match]}` }))}
                    />
                  </SaveForm>
                )}
              </div>
            </details>
            <details className="action">
              <summary>Neue Anfrage anlegen</summary>
              <div className="inbox-mail__action-body">
                <p className="rw-card__note">
                  {recognised > 0 ? <><strong>{recognised} {recognised === 1 ? "Angabe" : "Angaben"} aus der E-Mail erkannt</strong> (markiert) – bitte prüfen und Fehlendes ergänzen. </> : "Aus der E-Mail ließ sich nichts sicher erkennen; bitte die Angaben eintragen. "}
                  Es wird keine Eingangsbestätigung versendet; die Anfrage geht wie jede neue Anfrage in die Erstbearbeitung.
                </p>
                <SaveForm action={createRequestFromMessage} submitLabel="Anfrage anlegen">
                  <HiddenField name="message_id" value={message.id} />
                  <RequestFields
                    values={{
                      ...found,
                      business_email: message.from_address ?? "",
                      requested_visit_date: found.requested_visit_date ?? addDays(today, 7),
                      description: `${message.subject}\n\n${message.body_text}`.trim().slice(0, 2000),
                    }}
                    hints={{
                      ...Object.fromEntries(Object.keys(found).map((field) => [field, hint(field as ExtractedField)])),
                      safety_risk: found.safety_risk ? "Hinweis auf eine Gefahr in der E-Mail erkannt – bitte prüfen." : undefined,
                    }}
                  />
                </SaveForm>
              </div>
            </details>
            <details className="action">
              <summary>Archivieren (kein Auftrag)</summary>
              <div className="inbox-mail__action-body">
                <p className="rw-card__note">Für Werbung, Lieferanten, Bewerbungen und alles ohne Auftragsbezug. Die E-Mail verschwindet aus „Offen“ und dem Zähler, bleibt aber im Archiv und lässt sich wiederherstellen.</p>
                <SaveForm action={archiveMessage} submitLabel="Archivieren" submitVariant="secondary">
                  <HiddenField name="message_id" value={message.id} />
                  <SelectField name="reason" label="Grund" required options={Object.entries(ARCHIVE_REASONS).map(([value, text]) => ({ value, label: text }))} />
                </SaveForm>
              </div>
            </details>
          </div>
        )}
      </div>
    </article>
  );
}
