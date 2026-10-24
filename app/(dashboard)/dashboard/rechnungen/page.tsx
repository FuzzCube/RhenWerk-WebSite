import type { Metadata } from "next";
import Link from "next/link";
import { PaymentForm } from "@/components/dashboard/payment-form";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
import { SearchSuggest } from "@/components/dashboard/ui/search-suggest";
import { SideMenu } from "@/components/dashboard/ui/side-menu";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { InvoiceStatusChip } from "@/components/dashboard/ui/status-chip";
import { Icon } from "@/components/ui";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { INVOICE_DATE_FIELDS, INVOICE_PAGE_SIZE, INVOICE_STATES, INVOICE_TABS, invoiceQuery, invoiceSummary, listInvoices, parseInvoiceFilters, type InvoiceListItem } from "@/lib/dashboard/invoices";
import { invoiceDisplayStatus, overdueAging } from "@/lib/display-status";
import { berlinDayKey, formatCalendarDate, formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { dueSoonHint } from "@/lib/hints";
import { nextReminderShort, shortStageLabel } from "@/lib/reminders";

export const metadata: Metadata = { title: "Rechnungen" };

const TAB_LABELS = { ...INVOICE_STATES, alle: "Alle" };
type Tab = (typeof INVOICE_TABS)[number];

// Side menu grouped like the request list: what needs doing first, then the stock
const GROUPS: { title: string; tabs: Tab[] }[] = [
  { title: "Handlungsbedarf", tabs: ["erledigen", "ueberfaellig", "bald"] },
  { title: "Bestand", tabs: ["offen", "bezahlt", "alle"] },
];
const ACTION_TABS: Tab[] = ["erledigen", "ueberfaellig"];
const DESCRIPTION: Record<Tab, string> = {
  erledigen: "Entwürfe ausstellen und Versand vermerken.",
  ueberfaellig: "Ausgestellt, Zahlungsziel überschritten und keine Zahlung erfasst. Mahnstufe in der Liste.",
  bald: "Zahlungsziel in den nächsten 7 Tagen, noch keine Zahlung erfasst.",
  offen: "Ausgestellte Rechnungen ohne erfasste Zahlung. Ausgestellt ist nicht eingenommen.",
  bezahlt: "Rechnungen mit erfasster Zahlung.",
  alle: "Alle Rechnungen einschließlich Entwürfe.",
};

// Invoices (task-7-2, redesigned in task-10-3; side menu like the request list after user feedback
// 13.10.2026): open receivables by age above the list. Issued is not collected. "Zahlung erfassen" in the row.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/rechnungen"));
  const filters = parseInvoiceFilters(await searchParams);
  const [{ rows, total, sumGross, sumNet, error }, summary] = await Promise.all([listInvoices(filters), invoiceSummary()]);
  const today = berlinDayKey(new Date());
  const pages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE));
  const tab = (filters.state || "alle") as Tab;
  const aging = overdueAging(summary.open, today);
  const openTotal = Math.round(summary.open.reduce((sum, row) => sum + row.total, 0) * 100) / 100;
  const overdueTotal = Math.round(aging.reduce((sum, bucket) => sum + bucket.total, 0) * 100) / 100;

  const columns: Column<InvoiceListItem>[] = [
    // Issue date under the number and net under gross keep the table within the list card next to the side menu
    { key: "number", header: "Rechnung", cell: (row) => <><span className="mono rw-nowrap">{row.invoice_number ?? "Entwurf"}</span>{row.issue_date && <span className="cell-sub rw-nowrap">ausgestellt <span className="mono">{formatCalendarDate(row.issue_date)}</span></span>}</>, mobile: "title" },
    { key: "customer", header: "Kunde", cell: (row) => <><strong className="rw-strong">{row.company_name}</strong><span className="cell-sub mono">{row.customer_number && <>{row.customer_number} · </>}{row.request_number}</span></> },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const soon = dueSoonHint(row.status, row.payment_due_date, today);
        return <>{<InvoiceStatusChip status={invoiceDisplayStatus(row.status, row.payment_due_date, today)} />}{soon && <span className="cell-sub">{soon.text}</span>}</>;
      },
    },
    { key: "due", header: "Fällig", cell: (row) => <span className="mono">{formatCalendarDate(row.payment_due_date)}</span>, mobile: "hide" },
    {
      key: "reminder",
      header: "Mahnstufe",
      cell: (row) => {
        if (!row.reminder || (row.reminder.last_stage === 0 && !row.overdue)) return <span className="rw-muted">–</span>;
        const next = row.overdue ? nextReminderShort(row.reminder, today) : null;
        return <span className="rw-nowrap">{row.reminder.last_stage > 0 ? shortStageLabel(row.reminder.last_stage) : <span className="rw-muted">Keine</span>}{next && <span className="cell-sub">{next}</span>}</span>;
      },
      mobile: "hide",
    },
    { key: "gross", header: "Brutto", cell: (row) => <><span className="mono rw-nowrap">{formatCurrency(row.total, row.currency)}</span><span className="cell-sub">netto <span className="mono rw-nowrap">{formatCurrency(row.subtotal, row.currency)}</span></span></>, align: "end" },
    {
      key: "action",
      header: "Aktion",
      cell: (row) => row.status === "draft"
        ? <Link href={`/dashboard/anfragen/${row.request_id}#rechnung`}>Ausstellen</Link>
        : (row.status === "issued" || row.status === "sent") && !row.paid_at
          ? (
            <details className="action rw-row-action">
              <summary>Zahlung erfassen</summary>
              <PaymentForm requestId={row.request_id} version={row.request_version} invoiceId={row.id} today={today} />
            </details>
          )
          : <span className="rw-muted">–</span>,
    },
  ];

  const tabHref = (key: Tab) => `/dashboard/rechnungen${invoiceQuery({ ...filters, state: key === "alle" ? "" : key, page: 1 })}`;
  const countOf = (key: Tab) => (summary.counts[key] === undefined ? null : summary.counts[key]!);

  return (
    <div className="dash-page rw-page rw-page--tight side-page">
      <header className="side-page__head">
        <div className="side-page__head-text">
          <h1 id="view-title" className="side-page__title">
            {TAB_LABELS[tab]}
            <span className="side-page__count mono">{countOf(tab) === null ? "–" : formatNumber(countOf(tab)!)}</span>
          </h1>
          <p className="side-page__desc">{DESCRIPTION[tab]}</p>
        </div>
        <div className="req2__toolbar">
          <form className="req2__search" method="get" role="search" aria-label="Rechnungen durchsuchen">
            <label className="sr-only" htmlFor="filter-suche">Rechnungs- oder Kundennummer</label>
            <Icon name="search" size={18} />
            <SearchSuggest area="rechnungen" id="filter-suche" name="suche" defaultValue={filters.q} placeholder="Rechnungs- oder Kundennummer" />
            <input type="hidden" name="status" value={tab} />
            <button className="rw-button-secondary req2__search-btn" type="submit">Suchen</button>
          </form>
        </div>
      </header>

      <div className="side-page__grid">
        <SideMenu
          label="Ansichten"
          title="Rechnungen"
          scope={["Ausgestellt ist nicht eingenommen.", "Musterrechnungen mit Demodaten."]}
          groups={GROUPS.map((group) => ({
            title: group.title,
            items: group.tabs.map((key) => ({ key, label: TAB_LABELS[key], href: tabHref(key), active: key === tab, count: countOf(key), actionable: ACTION_TABS.includes(key) })),
          }))}
        />

        <div className="side-page__main">
          {summary.error && <ErrorState title="Die Übersicht der Forderungen konnte nicht vollständig geladen werden." action={<Link className="rw-button-secondary" href="/dashboard/rechnungen">Erneut versuchen</Link>}>Die Liste unten ist davon nicht betroffen.</ErrorState>}

          {/* Open receivables in one row: totals, then the overdue amount by age */}
          <section className={`rw-card rw-card--list rw-card--flush ${overdueTotal > 0 ? "rw-card--attention" : "rw-card--success"}`} aria-labelledby="receivables-title">
            <header className="rw-card__header">
              <div className="rw-card__heading">
                <div>
                  <h2 id="receivables-title" className="rw-card__title">Offene Forderungen</h2>
                  <p className="rw-card__description rw-card__note">Ausgestellt, ohne erfasste Zahlung · brutto · Überfälliges nach Alter</p>
                </div>
              </div>
              <Link className="rw-link-btn" href={tabHref("offen")}><span className="mono">{formatNumber(summary.counts.offen ?? 0)}</span>&nbsp;Rechnungen<Icon name="chevron-right" size={16} /></Link>
            </header>
            <ul className="inv-receivables">
              <li className="inv-receivables__total">
                <span className="inv-receivables__label">Offen gesamt</span>
                <span className="inv-receivables__value mono">{formatCurrency(openTotal)}</span>
              </li>
              <li className="inv-receivables__total">
                <span className="inv-receivables__label">davon überfällig</span>
                <span className="inv-receivables__value mono">{formatCurrency(overdueTotal)}</span>
              </li>
              {aging.map((bucket) => (
                <li key={bucket.key}>
                  <span className="inv-receivables__label">{bucket.label}</span>
                  <span className="inv-receivables__value inv-receivables__value--small mono">{formatCurrency(bucket.total)}</span>
                  <span className="rw-sub">{formatNumber(bucket.count)} {bucket.count === 1 ? "Rechnung" : "Rechnungen"}</span>
                  <span className="rw-bars__track rw-bars__track--warn" aria-hidden="true"><span style={{ width: `${overdueTotal > 0 ? (bucket.total / overdueTotal) * 100 : 0}%` }} /></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="side-page__list" id="rechnungsliste" aria-labelledby="view-title">
            {filters.field && (
              <p className="active-selection">
                <span>Auswahl: {INVOICE_DATE_FIELDS[filters.field].label} {formatDateTime(filters.from)} bis vor {formatDateTime(filters.to)}</span>
                <Link href={`/dashboard/rechnungen${invoiceQuery({ ...filters, field: "", from: "", to: "", page: 1 })}`}>Auswahl entfernen</Link>
              </p>
            )}

            {error ? (
              <ErrorState title="Die Rechnungen konnten nicht geladen werden." action={<Link className="rw-button-secondary" href={`/dashboard/rechnungen${invoiceQuery(filters)}`}>Erneut versuchen</Link>}>Filter bleiben erhalten.</ErrorState>
            ) : (
              <>
                <div className="side-page__list-bar">
                  <p className="result-count" role="status">
                    {formatNumber(total)} {total === 1 ? "Rechnung" : "Rechnungen"} · Summe brutto <strong className="mono" data-sum="gross">{formatCurrency(sumGross)}</strong> · netto <span className="mono">{formatCurrency(sumNet)}</span>
                    {total > 0 && pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
                  </p>
                  {filters.q && <span>Suche „{filters.q}“ · <Link href={`/dashboard/rechnungen${invoiceQuery({ ...filters, q: "", page: 1 })}`}>zurücksetzen</Link></span>}
                </div>
                <DataTable
                  caption="Rechnungen"
                  columns={columns}
                  rows={rows}
                  rowKey={(row) => row.id}
                  rowHref={(row) => `/dashboard/anfragen/${row.request_id}#rechnung`}
                  empty={
                    <EmptyState
                      title={tab === "erledigen" ? "Keine Entwürfe und kein offener Versand" : "Keine Rechnungen in dieser Ansicht"}
                      tone={tab === "erledigen" || tab === "ueberfaellig" ? "good" : "neutral"}
                      action={filters.q || filters.field ? <Link className="rw-button-secondary" href={`/dashboard/rechnungen${invoiceQuery({ ...filters, q: "", field: "", from: "", to: "", page: 1 })}`}>Suche und Auswahl zurücksetzen</Link> : undefined}
                    >
                      {[filters.q && `Suche „${filters.q}“`, `Ansicht „${TAB_LABELS[tab]}“`].filter(Boolean).join(" · ")}
                    </EmptyState>
                  }
                />
                {pages > 1 && (
                  <nav className="pagination" aria-label="Seiten">
                    {filters.page > 1 ? <Link href={`/dashboard/rechnungen${invoiceQuery(filters, { page: filters.page - 1 })}`} rel="prev">← Vorherige Seite</Link> : <span aria-hidden="true" />}
                    <span>Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></span>
                    {filters.page < pages ? <Link href={`/dashboard/rechnungen${invoiceQuery(filters, { page: filters.page + 1 })}`} rel="next">Nächste Seite →</Link> : <span aria-hidden="true" />}
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
