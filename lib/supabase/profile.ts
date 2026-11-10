import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/supabase/sesion";

export type Perfil = {
  id: string;
  nombre: string | null;
  rol: "admin" | "consulta" | "calidad";
};

// Trae el usuario logueado junto con su rol (admin / consulta).
// Se usa en Server Components para decidir qué mostrar y en las
// acciones de servidor para no confiar nunca en el rol que mande el cliente.
export const getPerfilActual = cache(async (): Promise<Perfil | null> => {
  const user = await usuarioActual();
  if (!user) return null;

  const { data: perfil } = await createClient()
    .from("profiles")
    .select("id, nombre, rol")
    .eq("id", user.id)
    .single();

  if (!perfil) return null;

  return perfil as Perfil;
});
