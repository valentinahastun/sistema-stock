import { createClient } from "@/lib/supabase/server";
import { getPerfilActual, type Perfil } from "@/lib/supabase/profile";
import type { Usuario } from "@/lib/usuario";

export type Accesos = {
  email: string;
  nombre: string;
  perfil: Perfil | null; // stock y calidad
  operaciones: Usuario | null; // operaciones comex
  stock: boolean;
  calidad: boolean;
};

const NOMBRES: Record<string, string> = { lourdes: "Lourdes", valentina: "Valentina" };

// Qué partes de la plataforma ve la persona logueada.
export async function getAccesos(): Promise<Accesos | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  const email = user.email.toLowerCase();

  const [perfil, { data: op }] = await Promise.all([
    getPerfilActual(),
    supabase.from("op_usuarios").select("email, rol, responsable").eq("email", email).maybeSingle(),
  ]);
  const operaciones = (op as Usuario | null) ?? null;

  return {
    email,
    nombre: perfil?.nombre ?? (operaciones?.responsable ? NOMBRES[operaciones.responsable] : null) ?? email.split("@")[0],
    perfil,
    operaciones,
    stock: !!perfil && perfil.rol !== "calidad",
    calidad: !!perfil,
  };
}
