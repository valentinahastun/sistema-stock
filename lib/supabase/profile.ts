import { createClient } from "@/lib/supabase/server";

export type Perfil = {
  id: string;
  nombre: string | null;
  rol: "admin" | "consulta" | "calidad";
};

// Trae el usuario logueado junto con su rol (admin / consulta).
// Se usa en Server Components para decidir qué mostrar y en las
// acciones de servidor para no confiar nunca en el rol que mande el cliente.
export async function getPerfilActual(): Promise<Perfil | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, nombre, rol")
    .eq("id", user.id)
    .single();

  if (!perfil) return null;

  return perfil as Perfil;
}
