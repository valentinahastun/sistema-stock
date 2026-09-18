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

// Borra un movimiento cargado por error. Si es el ingreso original de un
// lote (el que lo dio de alta), borra también el lote, pero solo si no
// tiene nada más cargado encima (otros movimientos o calidad vinculada).
export async function eliminarMovimiento(movimientoId: string): Promise<Resultado> {
  try {
    await verificarAdmin();
    const supabase = createClient();

    const { data: movimiento, error: errorMov } = await supabase
      .from("movimientos_stock")
      .select("id, lote_id, tipo, motivo")
      .eq("id", movimientoId)
      .single();

    if (errorMov || !movimiento) {
      return { ok: false, error: "No se encontró el movimiento." };
    }

    if (movimiento.tipo === "ingreso") {
      const { count: otrosMovimientos } = await supabase
        .from("movimientos_stock")
        .select("id", { count: "exact", head: true })
        .eq("lote_id", movimiento.lote_id)
        .neq("id", movimiento.id);

      if ((otrosMovimientos ?? 0) > 0) {
        return {
          ok: false,
          error:
            "Es el ingreso original del lote y ya tiene otros movimientos (descartes o egresos) cargados encima. Borrá esos primero.",
        };
      }

      const { count: calidadVinculada } = await supabase
        .from("registros_calidad")
        .select("id", { count: "exact", head: true })
        .eq("lote_id", movimiento.lote_id);

      if ((calidadVinculada ?? 0) > 0) {
        return {
          ok: false,
          error:
            "Este lote tiene un registro de calidad vinculado. Desvinculalo antes de borrar el ingreso.",
        };
      }

      const { error: errorDelMov } = await supabase
        .from("movimientos_stock")
        .delete()
        .eq("id", movimiento.id);
      if (errorDelMov) return { ok: false, error: errorDelMov.message };

      const { error: errorDelLote } = await supabase
        .from("lotes")
        .delete()
        .eq("id", movimiento.lote_id);
      if (errorDelLote) return { ok: false, error: errorDelLote.message };
    } else {
      const { error: errorDel } = await supabase
        .from("movimientos_stock")
        .delete()
        .eq("id", movimiento.id);
      if (errorDel) return { ok: false, error: errorDel.message };

      // Si era el descarte que había marcado el lote como "procesado" y no
      // queda ningún otro descarte de procesamiento, el lote vuelve a "natural".
      if (movimiento.tipo === "descarte" && movimiento.motivo === "procesamiento") {
        const { count: quedanProcesamiento } = await supabase
          .from("movimientos_stock")
          .select("id", { count: "exact", head: true })
          .eq("lote_id", movimiento.lote_id)
          .eq("tipo", "descarte")
          .eq("motivo", "procesamiento");

        if ((quedanProcesamiento ?? 0) === 0) {
          await supabase.from("lotes").update({ estado: "natural" }).eq("id", movimiento.lote_id);
        }
      }
    }

    revalidatePath("/");
    revalidatePath("/movimientos");
    revalidatePath("/stock");
    revalidatePath("/ingresos");
    revalidatePath("/egresos");
    revalidatePath("/calidad");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
