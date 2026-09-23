"use server";

import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { registrarEliminacion } from "@/lib/eliminaciones";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; error: string };

async function verificarAdmin() {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") {
    throw new Error("Solo el usuario administrador puede cargar movimientos.");
  }
  return perfil;
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
    const transportista = (formData.get("transportista") as string) || null;
    const chofer = (formData.get("chofer") as string) || null;
    const patente = (formData.get("patente") as string) || null;
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
        transportista,
        chofer,
        patente,
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

// Movimiento "directo": compra y venta que nunca pasa por el depósito
// propio. No toca ninguna planta ni resta/suma stock: solo queda
// registrado (producto, cantidad, CP, transporte) junto con
// titular/productor/destino tal como figuran en la CP, a modo de
// trazabilidad de por dónde pasó la mercadería.
export async function crearMovimientoDirecto(formData: FormData): Promise<Resultado> {
  try {
    await verificarAdmin();
    const supabase = createClient();

    const producto_id = formData.get("producto_id") as string;
    const numero_cp = (formData.get("numero_cp") as string) || null;
    const transportista = (formData.get("transportista") as string) || null;
    const chofer = (formData.get("chofer") as string) || null;
    const patente = (formData.get("patente") as string) || null;
    const titular = (formData.get("titular") as string) || null;
    const productor_texto = (formData.get("productor_texto") as string) || null;
    const destino = (formData.get("destino") as string) || null;
    const cantidad = Number(formData.get("cantidad"));
    const cantidadDescargadaRaw = formData.get("cantidad_descargada") as string;
    const cantidad_descargada = cantidadDescargadaRaw ? Number(cantidadDescargadaRaw) : null;
    const fecha = formData.get("fecha") as string;
    const observaciones = (formData.get("observaciones") as string) || null;

    if (!producto_id || !cantidad) {
      return { ok: false, error: "Faltan datos obligatorios." };
    }

    const { error } = await supabase.from("movimientos_stock").insert({
      tipo: "directo",
      producto_id,
      numero_cp,
      transportista,
      chofer,
      patente,
      titular,
      productor_texto,
      destino,
      cantidad,
      cantidad_descargada,
      fecha,
      observaciones,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/");
    revalidatePath("/movimientos");
    revalidatePath("/directos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Egreso "general": no se elige un lote puntual, se elige planta +
// producto (y opcionalmente productor, solo a modo de registro) y se
// resta directo del stock general de esa planta/producto, sin tocar el
// stock de ningún lote en particular.
export async function crearEgreso(formData: FormData): Promise<Resultado> {
  try {
    await verificarAdmin();
    const supabase = createClient();

    const planta_id = formData.get("planta_id") as string;
    const producto_id = formData.get("producto_id") as string;
    const productor_id = (formData.get("productor_id") as string) || null;
    const numero_cp = (formData.get("numero_cp") as string) || null;
    const transportista = (formData.get("transportista") as string) || null;
    const chofer = (formData.get("chofer") as string) || null;
    const patente = (formData.get("patente") as string) || null;
    const destino = (formData.get("destino") as string) || null;
    const cantidad = Number(formData.get("cantidad"));
    const fecha = formData.get("fecha") as string;
    const observaciones = (formData.get("observaciones") as string) || null;

    if (!planta_id || !producto_id || !cantidad) {
      return { ok: false, error: "Faltan datos obligatorios." };
    }

    const { data: stockFila } = await supabase
      .from("stock_consolidado")
      .select("stock_disponible_tn")
      .eq("planta_id", planta_id)
      .eq("producto_id", producto_id)
      .maybeSingle();

    const disponible = Number(stockFila?.stock_disponible_tn ?? 0);
    if (cantidad > disponible) {
      return {
        ok: false,
        error: `No hay suficiente stock disponible en esa planta/producto (disponible: ${disponible.toFixed(
          2
        )} tn).`,
      };
    }

    const { error } = await supabase.from("movimientos_stock").insert({
      tipo: "egreso",
      planta_id,
      producto_id,
      productor_id,
      numero_cp,
      transportista,
      chofer,
      patente,
      destino,
      cantidad,
      fecha,
      observaciones,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/");
    revalidatePath("/movimientos");
    revalidatePath("/egresos");
    revalidatePath("/stock");
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
    const perfil = await verificarAdmin();
    const supabase = createClient();

    const { data: movimiento, error: errorMov } = await supabase
      .from("movimientos_stock")
      .select("*")
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

      const { data: loteRow } = await supabase
        .from("lotes")
        .select("*")
        .eq("id", movimiento.lote_id)
        .single();

      const logMov = await registrarEliminacion(
        supabase,
        perfil,
        "movimientos_stock",
        movimiento.id,
        movimiento
      );
      if (!logMov.ok) return logMov;

      if (loteRow) {
        const logLote = await registrarEliminacion(
          supabase,
          perfil,
          "lotes",
          loteRow.id,
          loteRow
        );
        if (!logLote.ok) return logLote;
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
      // Si este descarte fue generado por "% de caída estimada", también
      // dio de alta un lote de descarte propio (ej: Descarte Negro) con
      // su ingreso. Si a ese lote ya se le cargó algo más (un egreso, una
      // calidad), no se puede deshacer solo: hay que borrar eso primero,
      // para no dejar un stock de descarte que en realidad no respalda nada.
      const loteDescarteId: string | null = movimiento.descarte_generado_lote_id ?? null;

      if (loteDescarteId) {
        const { count: movimientosDelDescarte } = await supabase
          .from("movimientos_stock")
          .select("id", { count: "exact", head: true })
          .eq("lote_id", loteDescarteId);

        if ((movimientosDelDescarte ?? 0) > 1) {
          return {
            ok: false,
            error:
              "El lote de descarte que generó este % de caída ya tiene otros movimientos cargados encima (por ejemplo un egreso). Borrá esos primero.",
          };
        }

        const { count: calidadDelDescarte } = await supabase
          .from("registros_calidad")
          .select("id", { count: "exact", head: true })
          .eq("lote_id", loteDescarteId);

        if ((calidadDelDescarte ?? 0) > 0) {
          return {
            ok: false,
            error:
              "El lote de descarte que generó este % de caída tiene un registro de calidad vinculado. Desvinculalo antes de borrar.",
          };
        }
      }

      const logMov = await registrarEliminacion(
        supabase,
        perfil,
        "movimientos_stock",
        movimiento.id,
        movimiento
      );
      if (!logMov.ok) return logMov;

      // Este movimiento (el descarte por "% de caída estimada") es el que
      // tiene descarte_generado_lote_id apuntando al lote de descarte. Hay
      // que borrarlo primero: si se intenta borrar el lote antes, la base
      // rechaza el borrado porque esta fila todavía lo referencia.
      const { error: errorDel } = await supabase
        .from("movimientos_stock")
        .delete()
        .eq("id", movimiento.id);
      if (errorDel) return { ok: false, error: errorDel.message };

      if (loteDescarteId) {
        const { data: movIngresoDescarte } = await supabase
          .from("movimientos_stock")
          .select("*")
          .eq("lote_id", loteDescarteId)
          .maybeSingle();

        const { data: loteDescarteRow } = await supabase
          .from("lotes")
          .select("*")
          .eq("id", loteDescarteId)
          .maybeSingle();

        if (movIngresoDescarte) {
          const logIngresoDescarte = await registrarEliminacion(
            supabase,
            perfil,
            "movimientos_stock",
            movIngresoDescarte.id,
            movIngresoDescarte
          );
          if (!logIngresoDescarte.ok) return logIngresoDescarte;

          const { error: errorDelIngresoDescarte } = await supabase
            .from("movimientos_stock")
            .delete()
            .eq("id", movIngresoDescarte.id);
          if (errorDelIngresoDescarte) {
            return { ok: false, error: errorDelIngresoDescarte.message };
          }
        }

        if (loteDescarteRow) {
          const logLoteDescarte = await registrarEliminacion(
            supabase,
            perfil,
            "lotes",
            loteDescarteRow.id,
            loteDescarteRow
          );
          if (!logLoteDescarte.ok) return logLoteDescarte;

          const { error: errorDelLoteDescarte } = await supabase
            .from("lotes")
            .delete()
            .eq("id", loteDescarteId);
          if (errorDelLoteDescarte) {
            return { ok: false, error: errorDelLoteDescarte.message };
          }
        }
      }

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
