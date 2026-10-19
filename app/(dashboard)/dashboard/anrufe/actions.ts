"use server";

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { databaseErrorMessage, formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "Rückruf erledigt" on the call page (task-13-7): same controlled operation as the banner for urgent calls
export async function markCallbackDone(_state: FormState, formData: FormData): Promise<FormState> {
  await requireRole(["dispatcher", "manager", "admin"]);
  const values = formValues(formData);
  if (!UUID.test(values.call_id ?? "")) return formError("Ungültige Anfrage. Bitte die Seite neu laden.", values);
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_call_callback", { call_id: values.call_id });
  if (error) return formError(databaseErrorMessage(error), values);
  refresh();
  return formSuccess("Rückruf als erledigt vermerkt.", values);
}
