"use server";

import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; error: string };

async function verificarAdmin() {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") {
    throw new Error("Solo el usuario administrador puede cargar movimientos.");
  }
}

// Alta de un lote nuevo + su movimiento de ingreso.
export async function crearIngreso(formData: FormData): Promise<Resultado> {
  try {
    await verificarAdmin();
    const supabase = createClient();

    const planta_id = formData.get("planta_id") as string;
    const producto_id = formData.get("producto_id") as string;
    const productor_id = formData.get("productor_id") as string;
    const estado = formData.get("estado") as string;
    const numero_cp = (formData.get("numero_cp") as string) || null;
    const fecha_ingreso = formData.get("fecha") as string;
    const cantidad = Number(formData.get("cantidad"));
    const observaciones = (formData.get("observaciones") as string) || null;

    if (!planta_id || !producto_id || !productor_id || !cantidad) {
      return { ok: false, error: "Faltan datos obligatorios." };
    }

    const { data: lote, error: errorLote } = await supabase
      .from("lotes")
      .insert({
        planta_id,
        producto_id,
        productor_id,
        estado,
        numero_cp,
        fecha_ingreso,
        cantidad_ingresada: cantidad,
      })
      .select("id")
      .single();

    if (errorLote || !lote) {
      return { ok: false, error: errorLote?.message ?? "No se pudo crear el lote." };
    }

    const { error: errorMov } = await supabase.from("movimientos_stock").insert({
      lote_id: lote.id,
      tipo: "ingreso",
      cantidad,
      fecha: fecha_ingreso,
      observaciones,
    });

    if (errorMov) {
      return { ok: false, error: errorMov.message };
    }

    revalidatePath("/");
    revalidatePath("/movimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Movimiento de descarte o egreso sobre un lote existente.
export async function crearMovimiento(formData: FormData): Promise<Resultado> {
  try {
    await verificarAdmin();
    const supabase = createClient();

    const lote_id = formData.get("lote_id") as string;
    const tipo = formData.get("tipo") as string;
    const cantidad = Number(formData.get("cantidad"));
    const fecha = formData.get("fecha") as string;
    const motivo = (formData.get("motivo") as string) || null;
    const observaciones = (formData.get("observaciones") as string) || null;

    if (!lote_id || !tipo || !cantidad) {
      return { ok: false, error: "Faltan datos obligatorios." };
    }

    const { error } = await supabase.from("movimientos_stock").insert({
      lote_id,
      tipo,
      cantidad,
      fecha,
      motivo,
      observaciones,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/");
    revalidatePath("/movimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
