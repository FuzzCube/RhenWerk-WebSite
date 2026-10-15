import { SelectField, TextAreaField, TextField } from "@/components/dashboard/ui/save-form";
import type { RequestFieldName } from "@/lib/request-fields";
import { LABELS, label } from "@/lib/status";

// Fields of a manually entered request, shared by the inbox (task-10-5) and the phone form (task-11-4).
// Order follows the website form: contact, site and equipment, request.
const options = (kind: keyof typeof LABELS) => Object.entries(LABELS[kind]).map(([value, text]) => ({ value, label: text }));

type Props = {
  values: Partial<Record<RequestFieldName, string>>;
  hints?: Partial<Record<RequestFieldName, string>>;
  // Standort (optional field of the website form); the inbox form leaves it out
  site?: boolean;
  descriptionRows?: number;
};

export function RequestFields({ values, hints = {}, site = false, descriptionRows = 6 }: Props) {
  return (
    <>
      <div className="form-grid">
        <TextField name="company_name" label="Firma" required defaultValue={values.company_name} hint={hints.company_name} />
        <TextField name="contact_name" label="Ansprechperson" required defaultValue={values.contact_name} hint={hints.contact_name} />
        <TextField name="business_email" label="E-Mail-Adresse" type="email" required defaultValue={values.business_email} hint={hints.business_email} />
        <TextField name="phone_number" label="Telefon" type="tel" required defaultValue={values.phone_number} hint={hints.phone_number} />
        <TextField name="street_house_number" label="Straße und Hausnummer" required defaultValue={values.street_house_number} hint={hints.street_house_number} />
        <TextField name="postal_code" label="PLZ" inputMode="numeric" required defaultValue={values.postal_code} hint={hints.postal_code} />
        <TextField name="city" label="Ort" required defaultValue={values.city} hint={hints.city} />
        {site && <TextField name="site_label" label="Standort (Halle, Gebäude)" defaultValue={values.site_label} hint={hints.site_label} />}
        <TextField name="customer_number" label="Kundennummer" defaultValue={values.customer_number} hint={hints.customer_number} />
        <SelectField name="equipment_kind" label="Anlagenart" required defaultValue={values.equipment_kind} hint={hints.equipment_kind} options={options("equipment_kind")} />
        <TextField name="manufacturer" label="Hersteller" defaultValue={values.manufacturer} hint={hints.manufacturer} />
        <TextField name="model_type" label="Modell / Typ" defaultValue={values.model_type} hint={hints.model_type} />
        <SelectField name="service_kind" label="Leistungsart" required defaultValue={values.service_kind} hint={hints.service_kind} options={options("service_kind")} />
        <TextField name="requested_visit_date" label="Wunschtermin" type="date" required defaultValue={values.requested_visit_date} hint={hints.requested_visit_date} />
        <SelectField name="customer_urgency" label="Dringlichkeit" required defaultValue={values.customer_urgency ?? "planbar"} hint={hints.customer_urgency} options={options("customer_urgency")} />
        <SelectField
          name="safety_risk"
          label="Sicherheitsgefahr"
          required
          defaultValue={values.safety_risk}
          options={options("safety_risk")}
          hint={hints.safety_risk ?? `Bei „${label("safety_risk", "known")}“ oder „${label("safety_risk", "unclear")}“ ist eine Prüfung erforderlich.`}
        />
      </div>
      <TextAreaField name="description" label="Beschreibung" required rows={descriptionRows} defaultValue={values.description} hint={hints.description} />
    </>
  );
}
