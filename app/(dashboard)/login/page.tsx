import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/dashboard/login-form";
import { Logo } from "@/components/ui";
import { logout } from "@/lib/auth/actions";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Anmeldung",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const session = await getSession();
  if (session.status === "active") redirect("/dashboard");

  return (
    <main className="dash-login">
      <div className="dash-login__card">
        <Link href="/" aria-label="Zur Website"><Logo /></Link>
        <h1>Mitarbeiterbereich</h1>
        {session.status === "no_access" ? (
          <>
            <p className="dash-login__error" role="alert">
              Für {session.email || "dieses Konto"} besteht kein aktives Mitarbeiterprofil. Bitte wenden Sie sich an die Administration.
            </p>
            <form action={logout}>
              <button className="button button--secondary" type="submit">Abmelden</button>
            </form>
          </>
        ) : (
          <>
            <p className="dash-login__hint">Konten werden von der Administration angelegt. Eine Registrierung ist nicht möglich.</p>
            <LoginForm />
            <Link className="dash-login__back" href="/auth/passwort-vergessen">Passwort vergessen?</Link>
          </>
        )}
      </div>
    </main>
  );
}
