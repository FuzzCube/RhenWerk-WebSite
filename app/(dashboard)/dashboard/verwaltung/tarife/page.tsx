import type { Metadata } from "next";
import { saveRate } from "@/app/(dashboard)/dashboard/verwaltung/actions";
import { ActiveFilter, showsInactive } from "@/components/dashboard/active-filter";
import { AdminShell } from "@/components/dashboard/admin-nav";
import { CheckboxField, HiddenField, SaveForm, SelectField, TextField } from "@/components/dashboard/ui/save-form";
import { EmptyState, ErrorState } from "@/components/dashboard/ui/states";
import { StatusBadge } from "@/components/dashboard/ui/status-badge";
import { BILLING_MODEL_LABELS } from "@/lib/admin";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { listRates, type ServiceRate } from "@/lib/dashboard/admin";
import { formatCurrency, formatNumber } from "@/lib/format";
import { label, LABELS } from "@/lib/status";

export const metadata: Metadata = { title: "Tarife" };

const serviceOptions = Object.entries(LABELS.service_kind).map(([value, text]) => ({ value, label: text }));
const billingOptions = Object.entries(BILLING_MODEL_LABELS).map(([value, text]) => ({ value, label: text }));
const decimal = (value: number) => formatNumber(value, 2).replace(/\./g, "");

function RateFields({ rate }: { rate?: ServiceRate }) {
  return (
    <>
      {rate && <HiddenField name="rate_id" value={rate.id} />}
      <div className="form-grid">
        <TextField name="code" label="Kürzel" required defaultValue={rate?.code} />
        <TextField name="display_name" label="Bezeichnung" required defaultValue={rate?.display_name} />
        <SelectField name="service_kind" label="Leistungsart" required defaultValue={rate?.service_kind} options={serviceOptions} />
        <SelectField name="billing_model" label="Abrechnung" required defaultValue={rate?.billing_model} options={billingOptions} />
        <TextField name="unit_price" label="Netto-Preis in €" required inputMode="decimal" defaultValue={rate ? decimal(rate.unit_price) : ""} hint="Je Stunde oder pauschal" />
        <TextField name="tax_rate" label="Steuersatz in %" required inputMode="decimal" defaultValue={rate ? decimal(rate.tax_rate) : "19"} />
      </div>
      <CheckboxField name="is_active" label="Aktiv (für neue Arbeitspositionen wählbar)" defaultChecked={rate?.is_active ?? true} />
    </>
  );
}

// Service rates (task-8-1). Work entries copy price and tax rate when they are recorded and issued invoices keep
// their items, so a change only affects later entries. Rates are deactivated, not deleted.
export default async function RatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(rolesFor("/dashboard/verwaltung"));
  const [rates, all] = await Promise.all([listRates(), searchParams.then(showsInactive)]);

  return (
    <AdminShell current="tarife" title="Tarife" count={rates?.filter((rate) => rate.is_active).length} description="Preisvorlagen für Arbeitspositionen. Änderungen gelten für später erfasste Positionen; bestehende Positionen und ausgestellte Rechnungen bleiben unverändert.">
      <details className="action">
        <summary>Tarif anlegen</summary>
        <SaveForm action={saveRate} submitLabel="Tarif anlegen" resetOnSuccess>
          <RateFields />
        </SaveForm>
      </details>

      {!rates ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : rates.length === 0 ? (
        <EmptyState title="Noch keine Tarife." />
      ) : (
        <div className="side-page__list">
          <div className="side-page__list-bar">
            <ActiveFilter basePath="/dashboard/verwaltung/tarife" all={all} active={rates.filter((rate) => rate.is_active).length} total={rates.length} label="Tarife anzeigen" />
            <span>Tarif öffnen zum Bearbeiten</span>
          </div>
          <RateList rates={all ? rates : rates.filter((rate) => rate.is_active)} />
        </div>
      )}
    </AdminShell>
  );
}

function RateList({ rates }: { rates: ServiceRate[] }) {
  if (rates.length === 0) return <EmptyState title="Keine aktiven Tarife." />;
  return (
    <ul className="rate-list" aria-label="Tarife">
      {rates.map((rate) => (
        <li key={rate.id}>
          <details className="action">
            <summary>
              <span className="rate-list__head">
                <span><span className="mono">{rate.code}</span> · {rate.display_name}</span>
                <span className="cell-sub cell-sub--inline">{label("service_kind", rate.service_kind)} · {BILLING_MODEL_LABELS[rate.billing_model]} · {formatCurrency(rate.unit_price)}{rate.billing_model === "hourly" ? " / Std." : ""} · {formatNumber(rate.tax_rate, 0)} % USt.</span>
              </span>
              <StatusBadge kind="profile_active" value={rate.is_active} />
            </summary>
            <SaveForm action={saveRate} submitLabel="Tarif speichern">
              <RateFields rate={rate} />
            </SaveForm>
          </details>
        </li>
      ))}
    </ul>
  );
}
