import type { Metadata } from "next";
import { SaveForm, TextField } from "@/components/dashboard/ui/save-form";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { changeOwnPassword } from "@/lib/auth/password-actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireEmployee } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mein Konto" };

// Own account (task-11-5): who is signed in, and the password change for every role
export default async function AccountPage() {
  const employee = await requireEmployee();
  return (
    <div className="dash-page rw-page rw-page--tight account-page">
      <header className="dash-page-header">
        <div>
          <h1>Mein Konto</h1>
          <p>{employee.displayName} · {ROLE_LABELS[employee.role]} · <span className="mono">{employee.email}</span></p>
        </div>
      </header>
      <section className="account-page__section" aria-labelledby="passwort-title">
        <h2 id="passwort-title" className="rw-card__title">Passwort ändern</h2>
        <p className="rw-card__note">Mindestens {MIN_PASSWORD_LENGTH} Zeichen. Nach der Änderung erhalten Sie eine Bestätigung per E-Mail.</p>
        <SaveForm action={changeOwnPassword} submitLabel="Passwort ändern" resetOnSuccess>
          <TextField name="current_password" label="Aktuelles Passwort" type="password" autoComplete="current-password" required />
          <TextField name="password" label="Neues Passwort" type="password" autoComplete="new-password" required />
          <TextField name="password_repeat" label="Neues Passwort wiederholen" type="password" autoComplete="new-password" required />
        </SaveForm>
      </section>
    </div>
  );
}
