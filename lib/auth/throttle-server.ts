import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginKey } from "./throttle";

// Database calls of the login pause (task-11-6), with the service role. If the database cannot be reached, the
// sign-in is not blocked by this layer (Supabase's own IP limit still applies).

export async function pauseRemaining(email: string) {
  const { data, error } = await createAdminClient().rpc("login_pause_remaining", { email_hash: loginKey(email) });
  return error ? 0 : (data ?? 0);
}

export async function recordFailure(email: string) {
  const { data, error } = await createAdminClient().rpc("login_failed", { email_hash: loginKey(email) });
  return error ? 0 : (data ?? 0);
}

export async function resetFailures(email: string) {
  if (email) await createAdminClient().rpc("login_reset", { email_hash: loginKey(email) });
}
