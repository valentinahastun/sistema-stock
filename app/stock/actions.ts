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

// Cómo se cargó la caída estimada: como % del stock actual del lote, o
// directamente en toneladas de descarte (cuando ya se sabe el número
// real que salió del proceso, es más simple tipearlo directo que
// convertirlo a %).
export type CaidaEstimadaInput =
  | { modo: "pct"; valor: string }
  | { modo: "tn"; valor: string };

// Confirma la caída estimada de un lote "natural": genera el descarte
// real sobre ese lote (lo que lo marca como "procesado", igual que un
// descarte manual por procesamiento) y da de alta, como stock propio,
// el ingreso del producto de descarte correspondiente (ej: Descarte
// Negro), por la cantidad calculada.
export async function confirmarCaidaEstimada(
  loteId: string,
  input: CaidaEstimadaInput
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede confirmarlo." };
    }
    const r = await aplicarCaida(createClient(), loteId, input);
    if (r.ok) revalidarStock();
    return r;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function revalidarStock() {
  revalidatePath("/stock");
  revalidatePath("/movimientos");
  revalidatePath("/ingresos");
  revalidatePath("/egresos");
  revalidatePath("/");
}

// Varias CP del mismo productor que forman un solo lote (entraron natural
// en los mismos días): la caída se carga una vez para todas y se reparte
// entre las CP en proporción a lo que tiene cada una. Cada CP queda con su
// propio descarte (y su propio ingreso de descarte), así se puede deshacer
// igual que siempre desde Movimientos.
export async function confirmarCaidaGrupo(
  loteIds: string[],
  input: CaidaEstimadaInput
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede confirmarlo." };
    }
    if (!loteIds.length) return { ok: false, error: "No hay CP para cargar." };
    const supabase = createClient();

    const [{ data: lotes }, { data: stocks }] = await Promise.all([
      supabase.from("lotes").select("id, estado, planta_id, producto_id, productor_id").in("id", loteIds),
      supabase.from("stock_lotes").select("lote_id, stock_actual_tn").in("lote_id", loteIds),
    ]);
    if (!lotes || lotes.length !== loteIds.length) return { ok: false, error: "No se encontraron todas las CP." };
    if (lotes.some((l) => l.estado !== "natural")) {
      return { ok: false, error: "Alguna de las CP ya está procesada. Recargá la página." };
    }
    const mismo = (k: "planta_id" | "producto_id" | "productor_id") => new Set(lotes.map((l) => l[k])).size === 1;
    if (!mismo("planta_id") || !mismo("producto_id") || !mismo("productor_id")) {
      return { ok: false, error: "Las CP no son de la misma planta, producto y productor." };
    }

    const stockDe = new Map((stocks ?? []).map((s) => [s.lote_id as string, Number(s.stock_actual_tn)]));
    const conStock = loteIds.filter((id) => (stockDe.get(id) ?? 0) > 0.0005);
    const total = conStock.reduce((acc, id) => acc + (stockDe.get(id) ?? 0), 0);
    if (total <= 0) return { ok: false, error: "Estas CP no tienen stock." };

    // Cuánto descarte va a cada CP
    const partes: { id: string; input: CaidaEstimadaInput }[] = [];
    if (input.modo === "pct") {
      const pct = Number(input.valor);
      if (input.valor === "" || Number.isNaN(pct) || pct <= 0 || pct > 100) {
        return { ok: false, error: "Tiene que ser un número mayor a 0 y hasta 100." };
      }
      conStock.forEach((id) => partes.push({ id, input }));
    } else {
      const tn = Math.round(Number(input.valor) * 1000) / 1000;
      if (input.valor === "" || Number.isNaN(tn) || tn <= 0) {
        return { ok: false, error: "Tiene que ser un número mayor a 0." };
      }
      if (tn > total + 0.0005) {
        return { ok: false, error: `No puede superar el stock de las CP (${total.toFixed(2)} tn).` };
      }
      let resto = tn;
      conStock.forEach((id, i) => {
        const stock = stockDe.get(id) ?? 0;
        const parte =
          i === conStock.length - 1 ? Math.min(Math.round(resto * 1000) / 1000, stock) : Math.round(((tn * stock) / total) * 1000) / 1000;
        resto -= parte;
        if (parte > 0) partes.push({ id, input: { modo: "tn", valor: String(parte) } });
      });
    }

    let hechas = 0;
    for (const p of partes) {
      const r = await aplicarCaida(supabase, p.id, p.input);
      if (!r.ok) {
        if (hechas) revalidarStock();
        return {
          ok: false,
          error: hechas
            ? `Se cargó en ${hechas} de ${partes.length} CP y falló en la siguiente: ${r.error}`
            : r.error,
        };
      }
      hechas++;
    }
    revalidarStock();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Carga la caída de un lote (sin chequear permisos ni revalidar pantallas)
async function aplicarCaida(
  supabase: ReturnType<typeof createClient>,
  loteId: string,
  input: CaidaEstimadaInput
): Promise<Resultado> {
  {
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

    let descarteTn: number;
    let pctParaGuardar: number;

    if (input.modo === "pct") {
      const pct = Number(input.valor);
      if (input.valor === "" || Number.isNaN(pct) || pct <= 0 || pct > 100) {
        return { ok: false, error: "Tiene que ser un número mayor a 0 y hasta 100." };
      }
      const bruto = (stockActual * pct) / 100;
      descarteTn = Math.min(Math.round(bruto * 1000) / 1000, stockActual);
      pctParaGuardar = pct;
    } else {
      const tn = Number(input.valor);
      if (input.valor === "" || Number.isNaN(tn) || tn <= 0) {
        return { ok: false, error: "Tiene que ser un número mayor a 0." };
      }
      if (tn > stockActual) {
        return {
          ok: false,
          error: `No puede superar el stock actual del lote (${stockActual.toFixed(2)} tn).`,
        };
      }
      descarteTn = Math.round(tn * 1000) / 1000;
      pctParaGuardar = Math.round((descarteTn / stockActual) * 10000) / 100;
    }

    if (descarteTn <= 0) {
      return { ok: false, error: "Eso no genera ningún descarte." };
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

    const origenTexto =
      input.modo === "pct"
        ? `caída estimada (${input.valor}%)`
        : `descarte cargado directo (${descarteTn.toFixed(2)} tn)`;

    const { error: errorIngresoDescarte } = await supabase.from("movimientos_stock").insert({
      lote_id: loteDescarte.id,
      tipo: "ingreso",
      cantidad: descarteTn,
      fecha: hoy,
      observaciones: `Generado automáticamente por ${origenTexto} del lote de ${productoOriginal.nombre}.`,
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
      observaciones: `Generado automáticamente por ${origenTexto}.`,
    });
    if (errorDescarte) return { ok: false, error: errorDescarte.message };

    // Queda guardado el % (cargado directo, o el equivalente calculado si
    // se cargó en tn) a modo de registro en el lote original.
    await supabase.from("lotes").update({ caida_pct_estimada: pctParaGuardar }).eq("id", loteId);

    return { ok: true };
  }
}

// Cantidad de bolsas de un lote procesado (25 kg, 50 kg y big bags).
// Un campo vacío queda sin dato.
export async function guardarBolsas(
  loteId: string,
  bolsas: { bolsas_25: number | null; bolsas_50: number | null; big_bags: number | null }
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede cargarlo." };
    }
    for (const v of Object.values(bolsas)) {
      if (v !== null && (!Number.isInteger(v) || v < 0)) {
        return { ok: false, error: "Las cantidades tienen que ser números enteros (sin decimales)." };
      }
    }
    const supabase = createClient();
    const { error } = await supabase.from("lotes").update(bolsas).eq("id", loteId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Traslado de un lote a otra planta (ej.: a reprocesar). No es una salida a
// una operación: el lote baja en la planta de origen ("traslado") y aparece
// igual (productor, producto, estado, CV) en la de destino.
export async function trasladarLote(
  loteId: string,
  datos: { plantaDestinoId: string; cantidad: string; fecha: string; numeroCp: string }
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede trasladar." };
    }
    const supabase = createClient();
    const cantidad = Math.round(Number(datos.cantidad) * 1000) / 1000;
    if (!datos.plantaDestinoId) return { ok: false, error: "Elegí la planta de destino." };
    if (!(cantidad > 0)) return { ok: false, error: "Las toneladas tienen que ser mayores a 0." };
    if (!datos.fecha) return { ok: false, error: "Falta la fecha." };

    const { data: lote } = await supabase.from("lotes").select("*").eq("id", loteId).single();
    if (!lote) return { ok: false, error: "No se encontró el lote." };
    if (lote.planta_id === datos.plantaDestinoId) return { ok: false, error: "La planta de destino es la misma." };

    const [{ data: sl }, { data: cons }, { data: plantas }] = await Promise.all([
      supabase.from("stock_lotes").select("stock_actual_tn").eq("lote_id", loteId).single(),
      supabase
        .from("stock_consolidado")
        .select("stock_disponible_tn")
        .eq("planta_id", lote.planta_id)
        .eq("producto_id", lote.producto_id)
        .maybeSingle(),
      supabase.from("plantas").select("id, nombre").in("id", [lote.planta_id, datos.plantaDestinoId]),
    ]);
    const maximo = Math.min(Number(sl?.stock_actual_tn ?? 0), Number(cons?.stock_disponible_tn ?? 0));
    if (cantidad > maximo + 0.0005) {
      return { ok: false, error: `No puede superar el stock del lote (${maximo.toFixed(2)} tn).` };
    }
    const nombre = (id: string) => plantas?.find((p) => p.id === id)?.nombre ?? "otra planta";
    const origen = nombre(lote.planta_id);
    const destino = nombre(datos.plantaDestinoId);
    const numeroCp = datos.numeroCp.trim() || null;

    const { data: nuevo, error: e1 } = await supabase
      .from("lotes")
      .insert({
        planta_id: datos.plantaDestinoId,
        producto_id: lote.producto_id,
        productor_id: lote.productor_id,
        estado: lote.estado,
        cv: lote.cv,
        tipo_descarte: lote.tipo_descarte ?? null,
        numero_cp: numeroCp,
        fecha_ingreso: datos.fecha,
        cantidad_ingresada: cantidad,
      })
      .select("id")
      .single();
    if (e1 || !nuevo) return { ok: false, error: e1?.message ?? "No se pudo crear el lote en destino." };

    const { error: e2 } = await supabase.from("movimientos_stock").insert({
      lote_id: nuevo.id,
      tipo: "ingreso",
      cantidad,
      fecha: datos.fecha,
      observaciones: `Traslado desde ${origen}${numeroCp ? ` (CP ${numeroCp})` : ""}`,
    });
    const { error: e3 } = e2
      ? { error: e2 }
      : await supabase.from("movimientos_stock").insert({
          lote_id: loteId,
          tipo: "traslado",
          cantidad,
          fecha: datos.fecha,
          numero_cp: numeroCp,
          observaciones: `Traslado a ${destino}`,
          lote_destino_id: nuevo.id,
        });
    if (e2 || e3) {
      await supabase.from("movimientos_stock").delete().eq("lote_id", nuevo.id);
      await supabase.from("lotes").delete().eq("id", nuevo.id);
      return { ok: false, error: (e2 ?? e3)!.message };
    }
    revalidarStock();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
