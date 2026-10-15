import type { Metadata } from "next";
import Link from "next/link";
import { SaveForm, TextField } from "@/components/dashboard/ui/save-form";
import { Logo } from "@/components/ui";
import { requestPasswordReset } from "@/lib/auth/password-actions";

export const metadata: Metadata = { title: "Passwort vergessen", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Request a reset link (task-11-5); the answer never reveals whether an account exists
export default async function ForgotPasswordPage({ searchParams }: Props) {
  const invalidLink = (await searchParams).link === "ungueltig";
  return (
    <main className="dash-login">
      <div className="dash-login__card">
        <Link href="/" aria-label="Zur Website"><Logo /></Link>
        <h1>Passwort vergessen</h1>
        {invalidLink && <p className="dash-login__error" role="alert">Der Link ist ungültig, abgelaufen oder wurde schon verwendet. Bitte einen neuen anfordern.</p>}
        <p className="dash-login__hint">Geben Sie die E-Mail-Adresse Ihres Kontos ein. Sie erhalten einen Link, mit dem Sie ein neues Passwort festlegen.</p>
        <SaveForm action={requestPasswordReset} submitLabel="Link anfordern" className="dash-login__form">
          <TextField name="email" label="E-Mail-Adresse" type="email" autoComplete="username" required />
        </SaveForm>
        <Link className="dash-login__back" href="/login">← Zur Anmeldung</Link>
      </div>
    </main>
  );
}
