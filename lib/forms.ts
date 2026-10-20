// Result contract of all dashboard save actions. On failure the action returns the submitted values,
// and SaveForm never resets the inputs, so nothing typed is lost.
export type FormState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
  // Changes with every completed save, so the UI can react to repeated results
  submittedAt: number | null;
  // Similar customers found before a manual creation (task-14-4); the form then asks for confirmation
  similarCustomers?: SimilarCustomer[];
};

export type SimilarCustomer = { id: string; customer_number: string; company: string; city: string | null; is_active: boolean; reason: string };

export const initialFormState: FormState = { status: "idle", message: null, fieldErrors: {}, values: {}, submittedAt: null };

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION") || typeof value !== "string") continue;
    values[key] = value;
  }
  return values;
}

export function formSuccess(message: string, values: Record<string, string> = {}): FormState {
  return { status: "success", message, fieldErrors: {}, values, submittedAt: Date.now() };
}

export function formError(message: string, values: Record<string, string>, fieldErrors: Record<string, string> = {}): FormState {
  return { status: "error", message, fieldErrors, values, submittedAt: Date.now() };
}

type DatabaseError = { code?: string; message?: string } | null | undefined;

// Error codes of the controlled database operations (docs/database.md)
export function databaseErrorMessage(error: DatabaseError): string {
  switch (error?.code) {
    case "42501":
      return "Keine Berechtigung für diese Aktion.";
    case "RW409":
      return "Der Datensatz wurde inzwischen von jemand anderem geändert. Ihre Eingaben bleiben erhalten; bitte die Seite neu laden und erneut prüfen.";
    case "RW404":
    case "RW410":
    case "RW422":
      return error.message || "Die Aktion ist im aktuellen Zustand nicht möglich.";
    default:
      return "Speichern fehlgeschlagen. Bitte erneut versuchen.";
  }
}
