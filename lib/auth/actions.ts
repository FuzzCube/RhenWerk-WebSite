"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "./session";
import { pauseMessage } from "./throttle";
import { pauseRemaining, recordFailure, resetFailures } from "./throttle-server";

export type LoginState = { error: string | null; email: string };

// Sign-in with e-mail and password. There is no sign-up; accounts are created by admins.
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Bitte E-Mail-Adresse und Passwort eingeben.", email };

  // Growing pause after repeated wrong passwords for this address (task-11-6); during the pause the password
  // is not checked at all
  const waiting = await pauseRemaining(email);
  if (waiting > 0) return { error: pauseMessage(waiting), email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message for unknown address and wrong password; the pause is counted for every address
  if (error) {
    const pause = await recordFailure(email);
    return { error: pause > 0 ? pauseMessage(pause) : "Anmeldung fehlgeschlagen. E-Mail-Adresse oder Passwort ist nicht korrekt.", email };
  }
  await resetFailures(email);

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  if (session.status !== "anonymous") {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
