import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Email confirmation / magic-link landing: exchange the PKCE code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, origin));
  }
  const message = searchParams.get("error_description") ?? "That sign-in link is invalid or has expired.";
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
}
