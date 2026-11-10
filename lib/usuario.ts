import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/supabase/sesion";

export type Usuario = {
  email: string;
  rol: "editor" | "lectura";
  responsable: "lourdes" | "valentina" | null;
};

// Usuario logueado y su permiso en el tracking (tabla op_usuarios).
// null = no hay sesión. rol null = tiene sesión pero no tiene acceso.
export const getUsuario = cache(async (): Promise<{ email: string; acceso: Usuario | null } | null> => {
  const user = await usuarioActual();
  if (!user?.email) return null;

  const email = user.email;
  const { data } = await createClient()
    .from("op_usuarios")
    .select("email, rol, responsable")
    .eq("email", email)
    .maybeSingle();

  return { email, acceso: (data as Usuario | null) ?? null };
});
