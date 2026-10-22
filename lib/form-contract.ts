export const REQUIRED_FIELDS = [
  "contact.company_name",
  "contact.contact_name",
  "contact.business_email",
  "contact.phone",
  "site_and_equipment.street_and_number",
  "site_and_equipment.postal_code",
  "site_and_equipment.city",
  "site_and_equipment.equipment_type",
  "request.service_type",
  "request.description",
  "request.urgency",
  "request.known_safety_hazard",
  "request.preferred_service_date",
  "privacy_consent",
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];
export type InvalidField = RequiredField | "contract_and_attachments.attachments" | "submission_id" | "request.requires_human_review";

export type Attachment = {
  file_name: string;
  pathname: string;
  mime_type: string;
  size_bytes: number;
  upload_status: "uploaded";
  url?: string;
  download_url?: string;
};

export type ServiceRequestPayload = {
  schema_version: "1.0";
  submission_id: string;
  source: "rheinwerk_website_service_request";
  locale: "de-DE";
  submitted_at: string;
  contact: {
    company_name: string;
    contact_name: string;
    business_email: string;
    phone: string;
    customer_number?: string;
  };
  site_and_equipment: {
    site_name?: string;
    street_and_number: string;
    postal_code: string;
    city: string;
    equipment_type: string;
    manufacturer?: string;
    model_or_type?: string;
    machine_number?: string;
  };
  request: {
    service_type: string;
    description: string;
    urgency: string;
    known_safety_hazard: string;
    preferred_service_date: string;
    // task-19-3: any, morning, afternoon or HH:MM; unknown values count as any
    preferred_time?: string;
    requires_human_review: boolean;
  };
  contract_and_attachments: {
    customer_or_sla_contract_number?: string;
    emergency_sla_24_7: boolean;
    attachments: Attachment[];
  };
  privacy_consent: boolean;
  turnstile_token?: string;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function validatePayload(input: unknown): RequiredField[] {
  if (!input || typeof input !== "object") return [...REQUIRED_FIELDS];
  const data = input as Partial<ServiceRequestPayload>;
  const invalid: RequiredField[] = [];
  if (text(data.contact?.company_name).length < 2) invalid.push("contact.company_name");
  if (text(data.contact?.contact_name).length < 2) invalid.push("contact.contact_name");
  if (!/^[^@\s]+@(?:[^@\s.]+\.)+[a-z]{2,}$/i.test(text(data.contact?.business_email))) invalid.push("contact.business_email");
  if (!/^[+0][\d\s()/-]{6,}$/.test(text(data.contact?.phone))) invalid.push("contact.phone");
  if (text(data.site_and_equipment?.street_and_number).length < 4) invalid.push("site_and_equipment.street_and_number");
  if (!/^\d{5}$/.test(text(data.site_and_equipment?.postal_code))) invalid.push("site_and_equipment.postal_code");
  if (text(data.site_and_equipment?.city).length < 2) invalid.push("site_and_equipment.city");
  if (!text(data.site_and_equipment?.equipment_type)) invalid.push("site_and_equipment.equipment_type");
  if (!text(data.request?.service_type)) invalid.push("request.service_type");
  if (text(data.request?.description).length < 10) invalid.push("request.description");
  if (!text(data.request?.urgency)) invalid.push("request.urgency");
  if (!text(data.request?.known_safety_hazard)) invalid.push("request.known_safety_hazard");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(data.request?.preferred_service_date))) invalid.push("request.preferred_service_date");
  if (data.privacy_consent !== true) invalid.push("privacy_consent");
  return invalid;
}

export function requiresHumanReview(payload: Pick<ServiceRequestPayload, "request">) {
  return payload.request.urgency === "production_stop" || payload.request.known_safety_hazard === "yes" || payload.request.known_safety_hazard === "unclear";
}
