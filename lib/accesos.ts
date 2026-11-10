import { cache } from "react";
import { usuarioActual } from "@/lib/supabase/sesion";
import { getPerfilActual, type Perfil } from "@/lib/supabase/profile";
import { getUsuario, type Usuario } from "@/lib/usuario";

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
// Perfil de stock y permiso de operaciones se piden a la vez.
export const getAccesos = cache(async (): Promise<Accesos | null> => {
  const user = await usuarioActual();
  if (!user?.email) return null;
  const email = user.email;

  const [perfil, usuario] = await Promise.all([getPerfilActual(), getUsuario()]);
  const operaciones = usuario?.acceso ?? null;

  return {
    email,
    nombre: perfil?.nombre ?? (operaciones?.responsable ? NOMBRES[operaciones.responsable] : null) ?? email.split("@")[0],
    perfil,
    operaciones,
    stock: !!perfil && perfil.rol !== "calidad",
    calidad: !!perfil,
  };
});
