"use server";

import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; error: string };

// Busca el producto de descarte vinculado a este producto (ej: Poroto
// Negro -> Descarte Negro). Si todavía no existe, lo crea la primera vez
// y queda vinculado para las próximas veces.
async function obtenerOCrearProductoDescarte(
  supabase: ReturnType<typeof createClient>,
  producto: { id: string; nombre: string; producto_descarte_id: string | null }
): Promise<string> {
  if (producto.producto_descarte_id) return producto.producto_descarte_id;

  const nombreDescarte = `Descarte ${producto.nombre.replace(/^Poroto\s+/i, "").trim()}`;

  const { data: existente } = await supabase
    .from("productos")
    .select("id")
    .eq("nombre", nombreDescarte)
    .maybeSingle();

  let descarteId: string;
  if (existente) {
    descarteId = existente.id;
  } else {
    const { data: nuevo, error: errorNuevo } = await supabase
      .from("productos")
      .insert({ nombre: nombreDescarte })
      .select("id")
      .single();
    if (errorNuevo || !nuevo) {
      throw new Error(errorNuevo?.message ?? "No se pudo crear el producto de descarte.");
    }
    descarteId = nuevo.id;
  }

  await supabase.from("productos").update({ producto_descarte_id: descarteId }).eq("id", producto.id);

  return descarteId;
}

// Confirma la caída estimada de un lote "natural": genera el descarte
// real sobre ese lote (lo que lo marca como "procesado", igual que un
// descarte manual por procesamiento) y da de alta, como stock propio,
// el ingreso del producto de descarte correspondiente (ej: Descarte
// Negro), por la cantidad calculada.
export async function confirmarCaidaEstimada(
  loteId: string,
  pctTexto: string
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede confirmarlo." };
    }

    const pct = Number(pctTexto);
    if (pctTexto === "" || Number.isNaN(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: "Tiene que ser un número mayor a 0 y hasta 100." };
    }

    const supabase = createClient();

    const { data: lote, error: errorLote } = await supabase
      .from("lotes")
      .select(
        "id, estado, planta_id, producto_id, productor_id, productos(nombre, producto_descarte_id)"
      )
      .eq("id", loteId)
      .single();

    if (errorLote || !lote) return { ok: false, error: "No se encontró el lote." };
    if (lote.estado !== "natural") {
      return { ok: false, error: "Este lote ya está procesado." };
    }

    const productoOriginal: any = Array.isArray(lote.productos) ? lote.productos[0] : lote.productos;
    if (!productoOriginal) return { ok: false, error: "No se encontró el producto del lote." };

    const { data: stockLote, error: errorStock } = await supabase
      .from("stock_lotes")
      .select("stock_actual_tn")
      .eq("lote_id", loteId)
      .single();

    if (errorStock || !stockLote) {
      return { ok: false, error: "No se pudo calcular el stock actual del lote." };
    }

    const stockActual = Number(stockLote.stock_actual_tn);
    const bruto = (stockActual * pct) / 100;
    const descarteTn = Math.min(Math.round(bruto * 1000) / 1000, stockActual);

    if (descarteTn <= 0) {
      return { ok: false, error: "El % ingresado no genera ningún descarte." };
    }

    const descarteProductoId = await obtenerOCrearProductoDescarte(supabase, {
      id: lote.producto_id,
      nombre: productoOriginal.nombre,
      producto_descarte_id: productoOriginal.producto_descarte_id,
    });

    const hoy = new Date().toISOString().slice(0, 10);

    // 1. Alta del lote de descarte como stock propio (ej: Descarte Negro),
    // en la misma planta y del mismo productor, para no perder trazabilidad.
    // Va primero para poder linkear el descarte real (paso 2) con este lote.
    const { data: loteDescarte, error: errorLoteDescarte } = await supabase
      .from("lotes")
      .insert({
        planta_id: lote.planta_id,
        producto_id: descarteProductoId,
        productor_id: lote.productor_id,
        estado: "natural",
        fecha_ingreso: hoy,
        cantidad_ingresada: descarteTn,
      })
      .select("id")
      .single();

    if (errorLoteDescarte || !loteDescarte) {
      return {
        ok: false,
        error: errorLoteDescarte?.message ?? "No se pudo crear el lote de descarte.",
      };
    }

    const { error: errorIngresoDescarte } = await supabase.from("movimientos_stock").insert({
      lote_id: loteDescarte.id,
      tipo: "ingreso",
      cantidad: descarteTn,
      fecha: hoy,
      observaciones: `Generado automáticamente por caída estimada (${pct}%) del lote de ${productoOriginal.nombre}.`,
    });
    if (errorIngresoDescarte) return { ok: false, error: errorIngresoDescarte.message };

    // 2. Descarte real sobre el lote original: resta el stock disponible
    // y lo marca "procesado" (mismo trigger que un descarte manual por
    // procesamiento). Queda linkeado al lote de descarte del paso 1: si
    // se borra este movimiento, se deshace todo junto (ver eliminarMovimiento).
    const { error: errorDescarte } = await supabase.from("movimientos_stock").insert({
      lote_id: loteId,
      tipo: "descarte",
      cantidad: descarteTn,
      fecha: hoy,
      motivo: "procesamiento",
      descarte_generado_lote_id: loteDescarte.id,
      observaciones: `Generado automáticamente por % de caída estimada (${pct}%).`,
    });
    if (errorDescarte) return { ok: false, error: errorDescarte.message };

    // Queda guardado el % usado, a modo de registro en el lote original.
    await supabase.from("lotes").update({ caida_pct_estimada: pct }).eq("id", loteId);

    revalidatePath("/stock");
    revalidatePath("/movimientos");
    revalidatePath("/ingresos");
    revalidatePath("/egresos");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
