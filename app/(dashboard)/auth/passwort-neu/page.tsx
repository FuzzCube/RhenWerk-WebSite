import type { Metadata } from "next";
import Link from "next/link";
import { SaveForm, TextField } from "@/components/dashboard/ui/save-form";
import { Logo } from "@/components/ui";
import { isFreshRecovery, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { setRecoveredPassword } from "@/lib/auth/password-actions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Neues Passwort", robots: { index: false, follow: false } };

// New password after the reset link (task-11-5); only reachable in the short session the link opened
export default async function NewPasswordPage() {
  const { data } = await (await createClient()).auth.getClaims();
  const allowed = isFreshRecovery(data?.claims?.amr as Parameters<typeof isFreshRecovery>[0]);
  return (
    <main className="dash-login">
      <div className="dash-login__card">
        <Link href="/" aria-label="Zur Website"><Logo /></Link>
        <h1>Neues Passwort festlegen</h1>
        {allowed ? (
          <>
            <p className="dash-login__hint">Mindestens {MIN_PASSWORD_LENGTH} Zeichen. Danach sind Sie angemeldet.</p>
            <SaveForm action={setRecoveredPassword} submitLabel="Passwort speichern" className="dash-login__form">
              <TextField name="password" label="Neues Passwort" type="password" autoComplete="new-password" required />
              <TextField name="password_repeat" label="Neues Passwort wiederholen" type="password" autoComplete="new-password" required />
            </SaveForm>
          </>
        ) : (
          <>
            <p className="dash-login__error" role="alert">Diese Seite ist nur über den Link aus der E-Mail erreichbar. Der Link ist abgelaufen oder wurde schon verwendet.</p>
            <Link className="button button--primary" href="/auth/passwort-vergessen">Neuen Link anfordern</Link>
          </>
        )}
        <Link className="dash-login__back" href="/login">← Zur Anmeldung</Link>
      </div>
    </main>
  );
}
