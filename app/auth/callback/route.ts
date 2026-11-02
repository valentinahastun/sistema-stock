import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Adonde vuelve el usuario después de iniciar sesión con Google.
// Intercambia el código que manda Google/Supabase por una sesión real.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
