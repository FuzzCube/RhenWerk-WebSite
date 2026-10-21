"use client";

import { useRef, useState } from "react";
import { SuggestField } from "@/components/dashboard/ui/save-form";
import type { Suggestion } from "@/lib/dashboard/suggestions";

// Always taken from the chosen customer and site
const MASTER_FIELDS = ["company_name", "street_house_number", "postal_code", "city", "site_label"] as const;
// Only filled while still empty: the caller may be another person of the customer
const CONTACT_FIELDS = ["contact_name", "business_email", "phone_number"] as const;

type Linked = { id: string; number: string; company: string };

// Customer number on the phone form (task-15-4): suggestions while typing, one per site. Choosing one fills the
// form and links the request to the customer on creation (hidden customer_id). Changing the number afterwards
// removes the link; an empty field means a new customer, numbered when the intake is completed.
export function CustomerNumberLookup({ defaultValue }: { defaultValue?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [linked, setLinked] = useState<Linked | null>(null);

  const setField = (name: string, value: string, onlyIfEmpty: boolean) => {
    const form = rootRef.current?.closest("form");
    const input = form?.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    if (onlyIfEmpty && input.value.trim() !== "") return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const pick = (item: Suggestion) => {
    const fields = item.fields;
    if (!fields?.customer_id) return;
    for (const name of MASTER_FIELDS) setField(name, fields[name] ?? "", false);
    for (const name of CONTACT_FIELDS) if (fields[name]) setField(name, fields[name], true);
    setLinked({ id: fields.customer_id, number: item.value, company: item.title });
  };

  const unlink = () => {
    setLinked(null);
    setField("customer_number", "", false);
    rootRef.current?.querySelector<HTMLInputElement>("input[name='customer_number']")?.focus();
  };

  return (
    <div ref={rootRef} className="customer-lookup">
      <SuggestField
        area="kundenstandort"
        name="customer_number"
        label="Kundennummer"
        className="field--lead"
        placeholder="Nummer, Firma oder Ort tippen"
        defaultValue={defaultValue}
        hint="Nennt der Anrufer seine Kundennummer, hier tippen und den passenden Standort wählen – Firma und Anschrift werden übernommen. Bei Neukunden leer lassen."
        onPick={pick}
        onType={() => linked && setLinked(null)}
      />
      <input type="hidden" name="customer_id" value={linked?.id ?? ""} readOnly />
      {linked && (
        <p className="customer-lookup__linked" role="status">
          <span>Bestandskunde <strong>{linked.number}</strong> · {linked.company} – die Anfrage wird mit diesem Kunden verknüpft.</span>
          <button type="button" className="button button--secondary" onClick={unlink}>Verknüpfung lösen</button>
        </p>
      )}
    </div>
  );
}
