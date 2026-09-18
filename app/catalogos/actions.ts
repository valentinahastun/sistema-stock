"use server";

import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; error: string };

async function verificarAdmin() {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") {
    throw new Error("Solo el usuario administrador puede editar los catálogos.");
  }
}

// Alta de una planta, producto o productor nuevo desde la app, sin
// depender de una migración SQL. Valida que no exista ya (comparando
// sin mayúsculas/espacios) para evitar duplicados por typo.
async function crear(tabla: string, nombreCrudo: string): Promise<Resultado> {
  try {
    await verificarAdmin();
    const nombre = nombreCrudo.trim();
    if (!nombre) {
      return { ok: false, error: "El nombre no puede estar vacío." };
    }

    const supabase = createClient();

    const { data: existentes } = await supabase.from(tabla).select("id, nombre");
    const yaExiste = (existentes ?? []).some(
      (e: { nombre: string }) => e.nombre.trim().toLowerCase() === nombre.toLowerCase()
    );
    if (yaExiste) {
      return { ok: false, error: `Ya existe "${nombre}" en este catálogo.` };
    }

    const { error } = await supabase.from(tabla).insert({ nombre });
    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/catalogos");
    revalidatePath("/movimientos");
    revalidatePath("/calidad");
    revalidatePath("/calidad/cargar");
    revalidatePath("/stock");
    revalidatePath("/ingresos");
    revalidatePath("/egresos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function crearPlanta(formData: FormData): Promise<Resultado> {
  return crear("plantas", (formData.get("nombre") as string) ?? "");
}

export async function crearProducto(formData: FormData): Promise<Resultado> {
  return crear("productos", (formData.get("nombre") as string) ?? "");
}

export async function crearProductor(formData: FormData): Promise<Resultado> {
  return crear("productores", (formData.get("nombre") as string) ?? "");
}
