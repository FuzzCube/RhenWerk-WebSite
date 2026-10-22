import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { accessHeaders } from "./access";
import { getSupabaseUrl } from "./env";

// Bypasses RLS. Only for controlled server operations and scripts, never for user-initiated reads.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Umgebungsvariable SUPABASE_SECRET_KEY fehlt. Siehe .env.example.");
  }

  return createClient<Database>(getSupabaseUrl(), secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: accessHeaders() },
  });
}
