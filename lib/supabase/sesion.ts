import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type UsuarioSesion = { id: string; email: string };

// Usuario logueado, leído una sola vez por clic (cache) y verificado con la
// firma del token (getClaims: con las claves asimétricas del proyecto no
// hace falta preguntarle a Supabase en cada página).
export const usuarioActual = cache(async (): Promise<UsuarioSesion | null> => {
  const { data } = await createClient().auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return { id: c.sub, email: String(c.email ?? "").toLowerCase() };
});
