import { createClient } from "@/lib/supabase/server";

export type Usuario = {
  email: string;
  rol: "editor" | "lectura";
  responsable: "lourdes" | "valentina" | null;
};

// Usuario logueado y su permiso en el tracking (tabla op_usuarios).
// null = no hay sesión. rol null = tiene sesión pero no tiene acceso.
export async function getUsuario(): Promise<{ email: string; acceso: Usuario | null } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const email = user.email.toLowerCase();
  const { data } = await supabase
    .from("op_usuarios")
    .select("email, rol, responsable")
    .eq("email", email)
    .maybeSingle();

  return { email, acceso: (data as Usuario | null) ?? null };
}
