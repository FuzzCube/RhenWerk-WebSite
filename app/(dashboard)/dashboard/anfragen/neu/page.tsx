import type { Metadata } from "next";
import Link from "next/link";
import { createPhoneRequest } from "@/app/(dashboard)/dashboard/anfragen/neu/actions";
import { RequestFields } from "@/components/dashboard/request-fields";
import { CheckboxField, HiddenField, SaveForm, SelectField } from "@/components/dashboard/ui/save-form";
import { requireRole } from "@/lib/auth/session";
import { addDays } from "@/lib/berlin-time";
import { berlinDayKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Telefonische Anfrage" };

// Request taken over the phone (task-11-4): same fields as the website form, entered by the person on the phone.
export default async function PhoneRequestPage() {
  const employee = await requireRole(["dispatcher", "manager", "admin"]);
  const chooseDispatcher = employee.role !== "dispatcher";
  const dispatchers = chooseDispatcher
    ? ((await (await createClient()).from("profiles").select("id, display_name").eq("role", "dispatcher").eq("is_active", true).order("display_name")).data ?? [])
    : [];
  const back = employee.role === "dispatcher" ? { href: "/dashboard/erstbearbeitung", label: "Erstbearbeitung" } : { href: "/dashboard/anfragen", label: "Anfragen" };

  return (
    <div className="dash-page rw-page rw-page--tight phone-request">
      <nav className="breadcrumb-dash" aria-label="Pfad">
        <Link href={back.href}>← {back.label}</Link>
      </nav>
      <header className="dash-page-header">
        <div>
          <h1>Telefonische Anfrage</h1>
          <p>
            Angaben aus dem Anruf eintragen. Die Anfrage erhält eine RIS-Nummer und geht wie jede neue Anfrage in die Erstbearbeitung.
            {employee.role === "dispatcher" ? " Sie wird Ihnen zugewiesen." : ""}
          </p>
        </div>
      </header>
      <section className="phone-request__form" aria-label="Angaben zur Anfrage">
        <SaveForm action={createPhoneRequest} submitLabel="Anfrage anlegen">
          <HiddenField name="submission_id" value={crypto.randomUUID()} />
          <RequestFields site customerLookup values={{ requested_visit_date: addDays(berlinDayKey(new Date()), 7) }} />
          {chooseDispatcher && (
            <SelectField
              name="dispatcher_id"
              label="Dispatcher"
              emptyLabel="Automatisch (geringste Auslastung)"
              hint="Ohne Auswahl erhält der Dispatcher mit den wenigsten Anfragen im laufenden Monat die Anfrage."
              options={dispatchers.map((row) => ({ value: row.id, label: row.display_name }))}
            />
          )}
          <CheckboxField name="send_receipt" label="Eingangsbestätigung mit RIS-Nummer per E-Mail an den Kunden senden" defaultChecked />
        </SaveForm>
      </section>
    </div>
  );
}
