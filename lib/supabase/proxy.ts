import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { accessHeaders } from "./access";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

// Refreshes the auth session and writes updated cookies to request and response.
// Route protection is not done here; it happens in the dashboard layout and in the database (RLS).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    global: { headers: accessHeaders() },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between client creation and getClaims(); it triggers the token refresh.
  await supabase.auth.getClaims();

  // Login and dashboard responses are personal: never stored by shared caches or the browser cache
  response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
  return response;
}
