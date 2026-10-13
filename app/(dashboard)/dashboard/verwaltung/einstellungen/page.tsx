import type { Metadata } from "next";
import { saveReminderSettings, saveSettings } from "@/app/(dashboard)/dashboard/verwaltung/actions";
import { AdminShell } from "@/components/dashboard/admin-nav";
import { SaveForm, TextField } from "@/components/dashboard/ui/save-form";
import { ErrorState } from "@/components/dashboard/ui/states";
import { COMPANY_FIELDS } from "@/lib/admin";
import { rolesFor } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { getSettings } from "@/lib/dashboard/admin";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Einstellungen" };

const decimal = (value: number) => formatNumber(value, 2).replace(/\./g, "").replace(/,00$/, "");

// Settings (task-8-1). Each request freezes the baseline when its initial processing is completed and each issued
// invoice its seller data, payment terms and tax rates, so changes only affect later processing and invoices.
export default async function SettingsPage() {
  await requireRole(rolesFor("/dashboard/verwaltung"));
  const settings = await getSettings();
  const company = (settings?.company_details ?? {}) as Record<string, unknown>;

  return (
    <AdminShell current="einstellungen" title="Einstellungen" description="Gelten nur für spätere Vorgänge: abgeschlossene Erstbearbeitungen behalten ihren Basiswert, ausgestellte Rechnungen ihre Angaben.">
      {!settings ? (
        <ErrorState><p>Bitte die Seite neu laden.</p></ErrorState>
      ) : (
        <>
          <p className="section-note">
            Zeitzone {settings.timezone} und Währung {settings.currency} sind fest. Zuletzt geändert: {formatDateTime(settings.updated_at)}{settings.updatedByName ? ` von ${settings.updatedByName}` : ""}.
          </p>
          <SaveForm action={saveSettings} submitLabel="Einstellungen speichern">
            <section className="request-section" aria-labelledby="betrieb-title">
              <h2 id="betrieb-title">Betrieb und Abrechnung</h2>
              <div className="form-grid">
                <TextField name="manual_intake_minutes" label="Basiswert manuelle Erstbearbeitung (Minuten)" required inputMode="decimal" defaultValue={decimal(settings.manual_intake_minutes)} hint="Grundlage der geschätzten Zeitersparnis. Gilt ab der nächsten abgeschlossenen Erstbearbeitung." />
                <TextField name="default_tax_rate" label="Standard-Steuersatz (%)" required inputMode="decimal" defaultValue={decimal(settings.default_tax_rate)} hint="Für Arbeitspositionen ohne Tarif-Steuersatz." />
                <TextField name="payment_terms_days" label="Zahlungsziel (Tage)" required inputMode="numeric" defaultValue={String(settings.payment_terms_days)} hint="Für später ausgestellte Rechnungen." />
              </div>
            </section>
            <section className="request-section" aria-labelledby="firma-title">
              <h2 id="firma-title">Firmenangaben auf Rechnungen</h2>
              <div className="form-grid">
                {COMPANY_FIELDS.map((field) => (
                  <TextField key={field.key} name={`company_${field.key}`} label={field.label} required={field.key === "company_name"} defaultValue={typeof company[field.key] === "string" ? (company[field.key] as string) : ""} />
                ))}
              </div>
            </section>
          </SaveForm>
          <SaveForm action={saveReminderSettings} submitLabel="Erinnerungsstufen speichern">
            <section className="request-section" aria-labelledby="mahnung-title">
              <h2 id="mahnung-title">Zahlungserinnerungen</h2>
              <p className="section-note">Täglich um 06:00 UTC prüft das System offene Rechnungen und versendet fällige Stufen automatisch. Leeres Feld = Stufe aus. Änderungen gelten nur für Erinnerungen, die noch nicht erstellt wurden; je Rechnung lassen sich Erinnerungen auf der Anfrageseite aussetzen.</p>
              <div className="form-grid">
                <TextField name="reminder_stage1_days" label="Zahlungserinnerung (Tage nach Fälligkeit)" inputMode="numeric" defaultValue={settings.reminder_stage1_days === null ? "" : String(settings.reminder_stage1_days)} />
                <TextField name="reminder_stage2_days" label="1. Mahnung (Tage nach der Erinnerung)" inputMode="numeric" defaultValue={settings.reminder_stage2_days === null ? "" : String(settings.reminder_stage2_days)} />
                <TextField name="reminder_stage3_days" label="2. Mahnung mit Hinweis auf Verzug (Tage nach der 1. Mahnung)" inputMode="numeric" defaultValue={settings.reminder_stage3_days === null ? "" : String(settings.reminder_stage3_days)} />
              </div>
            </section>
          </SaveForm>
        </>
      )}
    </AdminShell>
  );
}
