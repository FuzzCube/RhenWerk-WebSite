"use client";

import Link from "next/link";
import { CheckboxField, useSaveFormState } from "@/components/dashboard/ui/save-form";
import { Icon } from "@/components/ui";

const REASON: Record<string, string> = {
  gleiche_email: "Gleiche E-Mail-Adresse",
  gleiche_firma: "Gleiche Firma, gleiche Postleitzahl",
  gleiche_firma_anderswo: "Gleiche Firma an anderem Standort",
  gleiche_domain: "Gleiche E-Mail-Domain",
};

// Duplicate check of "Kunde anlegen" (task-14-4): similar customers with link; creating anyway needs the checkbox
export function SimilarCustomers() {
  const { state } = useSaveFormState();
  const similar = state.similarCustomers ?? [];
  if (similar.length === 0) return null;
  return (
    <div className="customer-suggest similar-customers" role="alert" key={state.submittedAt}>
      <p className="customer-suggest__title"><Icon name="info" size={18} />Ähnlicher Kunde vorhanden</p>
      <p className="section-note">Bitte prüfen, ob der Kunde schon angelegt ist. Neue Standorte lassen sich auf der Kundenseite hinzufügen.</p>
      <ul className="customer-suggest__list">
        {similar.map((customer) => (
          <li key={customer.id} className="customer-suggest__item" data-similar={customer.customer_number}>
            <span className="customer-suggest__text">
              <Link href={`/dashboard/kunden/${customer.id}`}><span className="mono">{customer.customer_number}</span> {customer.company}</Link>
              <span className="customer-suggest__reason">{REASON[customer.reason] ?? customer.reason}{!customer.is_active && " · deaktiviert"}</span>
              {customer.city && <span className="cell-sub">{customer.city}</span>}
            </span>
          </li>
        ))}
      </ul>
      <CheckboxField name="confirm_duplicate" label="Trotzdem als neuen Kunden anlegen" />
    </div>
  );
}
