"use server";

import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { registrarEliminacion } from "@/lib/eliminaciones";
import { revalidatePath } from "next/cache";

type Resultado = { ok: true } | { ok: false; error: string };

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Cocción, hidratación y decisión de apto (ver 0016_coccion_hidratacion.sql).
// Se usa al cargar un análisis nuevo y al completarlo después, porque la
// hidratación lleva horas de remojo y suele estar lista al día siguiente.
function leerCoccion(formData: FormData):
  | { ok: true; datos: Record<string, number | string | boolean | null> }
  | { ok: false; error: string } {
  const coccion_minutos = numOrNull(formData.get("coccion_minutos"));
  const resultado = strOrNull(formData.get("coccion_resultado"));
  const hidratacion_peso_seco = numOrNull(formData.get("hidratacion_peso_seco"));
  const hidratacion_peso_hidratado = numOrNull(formData.get("hidratacion_peso_hidratado"));
  const aptoTxt = strOrNull(formData.get("apto"));

  if (resultado !== null && resultado !== "bien" && resultado !== "mal") {
    return { ok: false, error: "El resultado de cocción tiene que ser bien o mal." };
  }
  if ((hidratacion_peso_seco === null) !== (hidratacion_peso_hidratado === null)) {
    return { ok: false, error: "Para la hidratación hacen falta los dos pesos: seco e hidratado." };
  }
  if (hidratacion_peso_seco !== null && hidratacion_peso_seco <= 0) {
    return { ok: false, error: "El peso seco tiene que ser mayor a cero." };
  }
  if (
    hidratacion_peso_seco !== null &&
    hidratacion_peso_hidratado !== null &&
    hidratacion_peso_hidratado < hidratacion_peso_seco
  ) {
    return { ok: false, error: "El peso hidratado no puede ser menor que el peso seco." };
  }

  return {
    ok: true,
    datos: {
      coccion_minutos,
      coccion_resultado: resultado,
      hidratacion_peso_seco,
      hidratacion_peso_hidratado,
      apto: aptoTxt === "si" ? true : aptoTxt === "no" ? false : null,
    },
  };
}

export async function guardarCalidad(formData: FormData): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || (perfil.rol !== "admin" && perfil.rol !== "calidad")) {
      throw new Error("No tenés permiso para cargar calidad.");
    }

    const supabase = createClient();

    const lote_id = strOrNull(formData.get("lote_id"));
    const planta_id = strOrNull(formData.get("planta_id"));
    const producto_id = strOrNull(formData.get("producto_id"));
    const productor_id = strOrNull(formData.get("productor_id"));
    const numero_contrato = strOrNull(formData.get("numero_contrato"));
    const fecha = formData.get("fecha") as string;
    const pct_bajo_zaranda = numOrNull(formData.get("pct_bajo_zaranda"));
    const pct_partidos = numOrNull(formData.get("pct_partidos"));
    const pct_tegumento_danado = numOrNull(formData.get("pct_tegumento_danado"));
    const pct_levemente_manchados = numOrNull(formData.get("pct_levemente_manchados"));
    const pct_manchados = numOrNull(formData.get("pct_manchados"));
    const pct_arrugados = numOrNull(formData.get("pct_arrugados"));
    const pct_otros_defectos_graves = numOrNull(formData.get("pct_otros_defectos_graves"));
    const pct_otros_defectos_leves = numOrNull(formData.get("pct_otros_defectos_leves"));
    const pct_materia_extrana = numOrNull(formData.get("pct_materia_extrana"));
    const pct_humedad = numOrNull(formData.get("pct_humedad"));
    const observaciones = strOrNull(formData.get("observaciones"));

    if (!fecha) {
      return { ok: false, error: "Falta la fecha." };
    }
    const coccion = leerCoccion(formData);
    if (!coccion.ok) return coccion;
    if (!lote_id && (!planta_id || !producto_id)) {
      return {
        ok: false,
        error:
          "Si todavía no existe el lote en el sistema, indicá al menos planta y producto para poder vincularlo después.",
      };
    }

    // Fotos y/o videos nuevos seleccionados en este envío (el input
    // acepta ambos tipos; la subida es genérica, no distingue).
    const archivos = formData
      .getAll("fotos")
      .filter((f): f is File => f instanceof File && f.size > 0);

    // Si ya había un registro de calidad para este lote, conservamos sus
    // fotos/videos (solo aplica cuando se está vinculando a un lote
    // existente; un registro suelto siempre es nuevo).
    let urls: string[] = [];
    if (lote_id) {
      const { data: existente } = await supabase
        .from("registros_calidad")
        .select("fotos")
        .eq("lote_id", lote_id)
        .maybeSingle();
      urls = [...(existente?.fotos ?? [])];
    }

    const carpeta = lote_id ?? `sueltos/${perfil.id}-${Date.now()}`;
    for (const archivo of archivos) {
      const nombreArchivo = `${carpeta}/${Date.now()}-${archivo.name}`;
      const { error: errorSubida } = await supabase.storage
        .from("calidad-fotos")
        .upload(nombreArchivo, archivo);

      if (errorSubida) {
        return {
          ok: false,
          error: `No se pudo subir un archivo: ${errorSubida.message}`,
        };
      }

      const { data: pub } = supabase.storage
        .from("calidad-fotos")
        .getPublicUrl(nombreArchivo);
      urls.push(pub.publicUrl);
    }

    const registro = {
      lote_id,
      planta_id: lote_id ? null : planta_id,
      producto_id: lote_id ? null : producto_id,
      productor_id: lote_id ? null : productor_id,
      numero_contrato,
      fecha,
      pct_bajo_zaranda,
      pct_partidos,
      pct_tegumento_danado,
      pct_levemente_manchados,
      pct_manchados,
      pct_arrugados,
      pct_otros_defectos_graves,
      pct_otros_defectos_leves,
      pct_materia_extrana,
      pct_humedad,
      observaciones,
      ...coccion.datos,
      fotos: urls,
      created_by: perfil.id,
    };

    const { error } = lote_id
      ? await supabase.from("registros_calidad").upsert(registro, { onConflict: "lote_id" })
      : await supabase.from("registros_calidad").insert(registro);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/calidad");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Elimina un registro de calidad cargado. Solo el administrador (es la
// única política de RLS que permite borrar en registros_calidad; calidad
// solo puede insertar y editar lo propio, no borrar).
export async function eliminarCalidad(registroId: string): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      throw new Error("Solo el usuario administrador puede eliminar un registro de calidad.");
    }
    if (!registroId) {
      return { ok: false, error: "Falta el registro a eliminar." };
    }

    const supabase = createClient();

    const { data: registro, error: errorRegistro } = await supabase
      .from("registros_calidad")
      .select("*")
      .eq("id", registroId)
      .single();

    if (errorRegistro || !registro) {
      return { ok: false, error: "No se encontró el registro de calidad." };
    }

    const log = await registrarEliminacion(
      supabase,
      perfil,
      "registros_calidad",
      registro.id,
      registro
    );
    if (!log.ok) return log;

    const { error } = await supabase
      .from("registros_calidad")
      .delete()
      .eq("id", registroId);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/calidad");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Vincula un registro de calidad "suelto" (sin lote_id) a un lote que ya
// se cargó en el sistema. Solo el administrador, porque tocar lote_id
// es tocar stock.
export async function vincularCalidad(
  registroId: string,
  loteId: string
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      throw new Error("Solo el administrador puede vincular un registro a un lote.");
    }
    if (!registroId || !loteId) {
      return { ok: false, error: "Falta el registro o el lote a vincular." };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("registros_calidad")
      .update({ lote_id: loteId })
      .eq("id", registroId);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/calidad");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Completa (o corrige) cocción, hidratación y apto de un análisis ya
// cargado. Admin y calidad; RLS decide sobre qué registros puede cada uno.
export async function completarCoccion(
  registroId: string,
  formData: FormData
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || (perfil.rol !== "admin" && perfil.rol !== "calidad")) {
      throw new Error("No tenés permiso para cargar calidad.");
    }
    if (!registroId) {
      return { ok: false, error: "Falta el registro a completar." };
    }
    const coccion = leerCoccion(formData);
    if (!coccion.ok) return coccion;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("registros_calidad")
      .update(coccion.datos)
      .eq("id", registroId)
      .select("id");

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "No se pudo guardar: el registro no existe o no tenés permiso para editarlo." };
    }

    revalidatePath("/calidad");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
