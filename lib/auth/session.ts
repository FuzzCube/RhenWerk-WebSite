import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEmployeeRole, startPageFor, type EmployeeRole } from "./roles";

export type Employee = {
  id: string;
  email: string;
  displayName: string;
  role: EmployeeRole;
};

export type SessionState =
  | { status: "anonymous" }
  | { status: "no_access"; email: string }
  | { status: "active"; employee: Employee };

// Data access layer: verifies the session (getClaims checks the JWT) and loads the own profile.
// RLS returns profiles only to active employees, so a missing row means "no profile" or "deactivated".
// Memoized per request; layouts, pages and actions call it independently.
export const getSession = cache(async (strict = false): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  // Polling must distinguish an unavailable auth/backend service from an invalid or revoked session.
  if (strict && error && (error.name === "AuthRetryableFetchError" || error.name === "AuthUnknownError" || (error.status ?? 0) >= 500)) {
    throw new Error("Sitzungsprüfung vorübergehend nicht verfügbar");
  }
  if (error || !claims?.sub) return { status: "anonymous" };

  const email = typeof claims.email === "string" ? claims.email : "";
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", claims.sub)
    .maybeSingle();

  if (strict && profileError) throw new Error("Mitarbeiterprüfung vorübergehend nicht verfügbar");

  if (!profile || !profile.is_active || !isEmployeeRole(profile.role)) return { status: "no_access", email };
  return { status: "active", employee: { id: profile.id, email, displayName: profile.display_name, role: profile.role } };
});

// Signed-in active employee or redirect to the login page
export async function requireEmployee(): Promise<Employee> {
  const session = await getSession();
  if (session.status !== "active") redirect("/login");
  return session.employee;
}

// Area restricted to certain roles; other employees land on their own start page
export async function requireRole(roles: readonly EmployeeRole[]): Promise<Employee> {
  const employee = await requireEmployee();
  if (!roles.includes(employee.role)) redirect(startPageFor(employee.role));
  return employee;
}
