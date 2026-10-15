import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Target of the password reset e-mail (task-11-5): verifies the one-time token, which opens a short session,
// and continues to the form for the new password. Invalid, used or expired links go back to the request form.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const target = request.nextUrl.clone();
  target.search = "";
  if (tokenHash && type === "recovery") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      target.pathname = "/auth/passwort-neu";
      return NextResponse.redirect(target);
    }
  }
  target.pathname = "/auth/passwort-vergessen";
  target.searchParams.set("link", "ungueltig");
  return NextResponse.redirect(target);
}
