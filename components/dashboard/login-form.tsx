"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth/actions";

const initialState: LoginState = { error: null, email: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);
  return (
    <form className="dash-login__form" action={action} noValidate>
      {state.error && <p className="dash-login__error" role="alert">{state.error}</p>}
      <label className="field" htmlFor="login-email">
        <span>E-Mail-Adresse</span>
        <input id="login-email" name="email" type="email" autoComplete="username" required defaultValue={state.email} aria-invalid={!!state.error} />
      </label>
      <label className="field" htmlFor="login-password">
        <span>Passwort</span>
        <input id="login-password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error} />
      </label>
      <button className="button button--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Anmeldung läuft …" : "Anmelden"}</button>
    </form>
  );
}
