"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { formError, formSuccess, formValues, type FormState } from "@/lib/forms";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { isFreshRecovery, newPasswordErrors } from "./password";
import { resetFailures } from "./throttle-server";
import { accessHeaders } from "@/lib/supabase/access";

// Password reset and change (task-11-5). Passwords are only passed to Supabase Auth: they are never stored,
// logged or sent back to the browser (error states return no values for password fields).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_SENT = "Wenn zu dieser Adresse ein Konto besteht, ist ein Link zum Festlegen eines neuen Passworts unterwegs. Er gilt eine Stunde.";

// Same answer for known and unknown addresses (and for rate limits), so the form reveals no accounts
export async function requestPasswordReset(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return formError("Bitte eine gültige E-Mail-Adresse angeben.", { email }, { email: "Bitte eine gültige E-Mail-Adresse angeben." });
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  // Supabase only accepts redirect targets from its allow list (config.toml), so a forged host header cannot
  // send the link elsewhere. In production SITE_URL fixes the domain (task-18-4: the form is also reachable under
  // *.vercel.app, which is not on the list, and the link would then only lead to the home page)
  const base = process.env.SITE_URL ?? `${protocol}://${host}`;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/bestaetigen` });
  return formSuccess(RESET_SENT, { email });
}

function authErrorMessage(code: string | undefined) {
  if (code === "same_password") return { password: "Das neue Passwort muss sich vom bisherigen unterscheiden." };
  if (code === "weak_password") return { password: "Das Passwort ist zu schwach. Bitte ein längeres wählen." };
  return null;
}

// New password after the reset link; only in a fresh session opened by that link
export async function setRecoveredPassword(_previous: FormState, formData: FormData): Promise<FormState> {
  const { password = "", password_repeat = "" } = formValues(formData);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!isFreshRecovery(data?.claims?.amr as Parameters<typeof isFreshRecovery>[0])) {
    return formError("Der Link ist abgelaufen oder wurde schon verwendet. Bitte einen neuen Link anfordern.", {});
  }
  const fieldErrors = newPasswordErrors(password, password_repeat);
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", {}, fieldErrors);
  const { data: updated, error } = await supabase.auth.updateUser({ password });
  if (error) {
    const known = authErrorMessage(error.code);
    return formError(known ? "Bitte die markierten Felder prüfen." : "Das Passwort konnte nicht gespeichert werden. Bitte erneut versuchen.", {}, known ?? {});
  }
  // Replace the link session with a normal password session, so the reset form cannot be used again with it
  await supabase.auth.signOut({ scope: "local" });
  // A new password ends a running pause from wrong attempts (task-11-6)
  await resetFailures(updated.user.email ?? "");
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: updated.user.email ?? "", password });
  redirect(signInError ? "/login" : "/dashboard?passwort=neu");
}

// Own change in "Mein Konto": the current password is checked with a separate sign-in that is ended at once
export async function changeOwnPassword(_previous: FormState, formData: FormData): Promise<FormState> {
  const employee = await requireEmployee();
  const { current_password = "", password = "", password_repeat = "" } = formValues(formData);
  const fieldErrors: Record<string, string> = current_password ? {} : { current_password: "Pflichtangabe." };
  Object.assign(fieldErrors, newPasswordErrors(password, password_repeat, current_password || undefined));
  if (Object.keys(fieldErrors).length > 0) return formError("Bitte die markierten Felder prüfen.", {}, fieldErrors);

  const check = createPlainClient(getSupabaseUrl(), getSupabasePublishableKey(), { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: accessHeaders() } });
  const { error: wrong } = await check.auth.signInWithPassword({ email: employee.email, password: current_password });
  if (wrong) return formError("Bitte die markierten Felder prüfen.", {}, { current_password: "Das aktuelle Passwort ist nicht korrekt." });
  await check.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const known = authErrorMessage(error.code);
    return formError(known ? "Bitte die markierten Felder prüfen." : "Das Passwort konnte nicht gespeichert werden. Bitte erneut versuchen.", {}, known ?? {});
  }
  return formSuccess("Passwort geändert. Eine Bestätigung ist per E-Mail unterwegs.");
}
