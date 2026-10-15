// Fields of a manually entered request (task-10-5 inbox, task-11-4 phone). The database repeats these checks in
// private.validate_request_fields; here they give field-level messages and keep the inputs.
export const REQUIRED_REQUEST_FIELDS = {
  company_name: "Firma",
  contact_name: "Ansprechperson",
  business_email: "E-Mail-Adresse",
  phone_number: "Telefon",
  street_house_number: "Straße und Hausnummer",
  postal_code: "PLZ",
  city: "Ort",
  equipment_kind: "Anlagenart",
  service_kind: "Leistungsart",
  requested_visit_date: "Wunschtermin",
  customer_urgency: "Dringlichkeit",
  safety_risk: "Sicherheitsgefahr",
  description: "Beschreibung",
} as const;
export const OPTIONAL_REQUEST_FIELDS = ["customer_number", "site_label", "manufacturer", "model_type"] as const;

export type RequestFieldName = keyof typeof REQUIRED_REQUEST_FIELDS | (typeof OPTIONAL_REQUEST_FIELDS)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requestFieldErrors(values: Record<string, string | undefined>) {
  const errors: Record<string, string> = {};
  for (const name of Object.keys(REQUIRED_REQUEST_FIELDS)) if (!values[name]?.trim()) errors[name] = "Pflichtangabe.";
  if (values.business_email?.trim() && !EMAIL.test(values.business_email.trim())) errors.business_email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (values.postal_code?.trim() && !/^\d{5}$/.test(values.postal_code.trim())) errors.postal_code = "Fünfstellige PLZ.";
  if (values.description?.trim() && values.description.trim().length < 10) errors.description = "Mindestens 10 Zeichen.";
  return errors;
}

// Payload for the database: all known fields, trimmed, empty optional fields as ""
export function requestFieldPayload(values: Record<string, string | undefined>) {
  return Object.fromEntries(
    [...Object.keys(REQUIRED_REQUEST_FIELDS), ...OPTIONAL_REQUEST_FIELDS].map((name) => [name, values[name]?.trim() ?? ""]),
  );
}
