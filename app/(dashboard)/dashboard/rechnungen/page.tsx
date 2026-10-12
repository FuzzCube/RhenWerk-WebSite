import type { Metadata } from "next";
import Link from "next/link";
import { AgingBars } from "@/components/dashboard/aging-bars";
import { PaymentForm } from "@/components/dashboard/payment-form";
import { Card } from "@/components/dashboard/ui/card";
import { DataTable, type Column } from "@/components/dashboard/ui/data-table";
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

// Invoices (task-7-2, redesigned in task-10-3 after the canvas "Rechnungen"): what to do, open
// receivables by age, and the list with tabs. Issued is not collected. "Zahlung erfassen" in the row.
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/rechnungen"));
  const filters = parseInvoiceFilters(await searchParams);
  const [{ rows, total, sumGross, sumNet, error }, summary] = await Promise.all([listInvoices(filters), invoiceSummary()]);
  const today = berlinDayKey(new Date());
  const pages = Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE));
  const tab = filters.state || "alle";
  const aging = overdueAging(summary.open, today);
  const openTotal = Math.round(summary.open.reduce((sum, row) => sum + row.total, 0) * 100) / 100;
  const overdueTotal = Math.round(aging.reduce((sum, bucket) => sum + bucket.total, 0) * 100) / 100;

  const columns: Column<InvoiceListItem>[] = [
    { key: "number", header: "Rechnung", cell: (row) => <span className="mono">{row.invoice_number ?? "Entwurf"}</span>, mobile: "title" },
    { key: "customer", header: "Kunde", cell: (row) => <><strong className="rw-strong">{row.company_name}</strong><span className="cell-sub mono">{row.request_number}</span></> },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const soon = dueSoonHint(row.status, row.payment_due_date, today);
        return <>{<InvoiceStatusChip status={invoiceDisplayStatus(row.status, row.payment_due_date, today)} />}{soon && <span className="cell-sub">{soon.text}</span>}</>;
      },
    },
    { key: "issued", header: "Ausgestellt", cell: (row) => <span className="mono">{formatCalendarDate(row.issue_date)}</span> },
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
    { key: "net", header: "Netto", cell: (row) => <span className="mono">{formatCurrency(row.subtotal, row.currency)}</span>, align: "end", mobile: "hide" },
    { key: "gross", header: "Brutto", cell: (row) => <span className="mono">{formatCurrency(row.total, row.currency)}</span>, align: "end" },
    {
      key: "action",
      header: "Aktion",
      cell: (row) => row.status === "draft"
        ? <Link href={`/dashboard/anfragen/${row.request_id}#aktionen`}>Ausstellen</Link>
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

  return (
    <div className="dash-page rw-page rw-page--tight">
      <header className="dash-page-header">
        <div>
          <h1>Rechnungen</h1>
          <p className="rw-page__sub">Ausgestellt ist nicht eingenommen: offen sind ausgestellte Rechnungen ohne erfasste Zahlung. Musterrechnungen mit Demodaten.</p>
        </div>
        <form className="rw-search" method="get" role="search" aria-label="Rechnungen durchsuchen">
          <label className="sr-only" htmlFor="filter-suche">Rechnungsnummer</label>
          <input id="filter-suche" className="rw-input" name="suche" type="search" defaultValue={filters.q} placeholder="RE-2026-…" />
          <input type="hidden" name="status" value={tab} />
          <button className="rw-button-secondary" type="submit">Suchen</button>
        </form>
      </header>

      {summary.error && <ErrorState title="Die Übersicht der Forderungen konnte nicht vollständig geladen werden." action={<Link className="rw-button-secondary" href="/dashboard/rechnungen">Erneut versuchen</Link>}>Die Liste unten ist davon nicht betroffen.</ErrorState>}

      <div className="rw-pair">
        {summary.todo.length === 0 ? (
          <Card stripe="success" title="Zu erledigen">
            <EmptyState tone="good" title="Keine Entwürfe und kein offener Versand">Überfällige Forderungen stehen rechts.</EmptyState>
          </Card>
        ) : (
          <Card stripe="action" title="Zu erledigen" count={summary.counts.erledigen} description="Entwurf ausstellen, Versand vermerken." action={<Link className="rw-link-btn" href="/dashboard/rechnungen?status=erledigen#rechnungsliste">Alle<Icon name="chevron-right" size={16} /></Link>}>
            <ul className="rw-rows rw-rows--todo">
              {summary.todo.map((row) => (
                // Two lines: customer and amount, then number and status (the status never squeezes the name)
                <li key={row.id}>
                  <Link className="rw-rows__label" href={`/dashboard/anfragen/${row.request_id}#rechnung`}>{row.company_name}</Link>
                  <span className="mono rw-rows__amount">{formatCurrency(row.total, row.currency)}</span>
                  <span className="rw-sub mono">{row.invoice_number ?? row.request_number}</span>
                  <InvoiceStatusChip status={invoiceDisplayStatus(row.status, row.payment_due_date, today)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card stripe={overdueTotal > 0 ? "attention" : "success"} title="Offene Forderungen" action={<span className="rw-card__aside"><span className="mono">{formatNumber(summary.counts.offen ?? 0)}</span> Rechnungen</span>}>
          <div className="rw-figures">
            <div><span className="rw-card__note">Offen gesamt (brutto)</span><span className="rw-figure mono">{formatCurrency(openTotal)}</span></div>
            <div><span className="rw-card__note">davon überfällig</span><span className="rw-figure mono">{formatCurrency(overdueTotal)}</span></div>
          </div>
          <h4 className="rw-subhead">Überfällig nach Alter</h4>
          <AgingBars buckets={aging} />
        </Card>
      </div>

      <section className="rw-zone" id="rechnungsliste" aria-labelledby="list-title">
        <div className="rw-zone__header"><div className="rw-zone__titles"><h2 id="list-title">Alle Rechnungen</h2></div></div>
        <nav className="rw-views" aria-label="Ansichten">
          {INVOICE_TABS.map((key) => (
            <Link key={key} className="rw-view" href={`/dashboard/rechnungen${invoiceQuery({ ...filters, state: key === "alle" ? "" : key, page: 1 })}`} aria-current={key === tab ? "page" : undefined}>
              {TAB_LABELS[key]}<span className="rw-view__count mono">{summary.counts[key] === undefined ? "–" : formatNumber(summary.counts[key]!)}</span>
            </Link>
          ))}
        </nav>

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
            <div className="rw-list-meta">
              <p className="result-count" role="status">
                {formatNumber(total)} {total === 1 ? "Rechnung" : "Rechnungen"} · Summe brutto <strong className="mono" data-sum="gross">{formatCurrency(sumGross)}</strong> · netto <span className="mono">{formatCurrency(sumNet)}</span>
                {total > 0 && pages > 1 && <> · Seite <span className="mono">{filters.page}</span> von <span className="mono">{pages}</span></>}
              </p>
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
  );
}
