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
    const pct_arrugados = numOrNull(formData.get("pct_arrugados"));
    const pct_otros_granos = numOrNull(formData.get("pct_otros_granos"));
    const pct_roido_picado = numOrNull(formData.get("pct_roido_picado"));
    const pct_humedad = numOrNull(formData.get("pct_humedad"));

    if (!fecha) {
      return { ok: false, error: "Falta la fecha." };
    }
    if (!lote_id && (!planta_id || !producto_id)) {
      return {
        ok: false,
        error:
          "Si todavía no existe el lote en el sistema, indicá al menos planta y producto para poder vincularlo después.",
      };
    }

    // Fotos nuevas seleccionadas en este envío.
    const archivos = formData
      .getAll("fotos")
      .filter((f): f is File => f instanceof File && f.size > 0);

    // Si ya había un registro de calidad para este lote, conservamos sus
    // fotos (solo aplica cuando se está vinculando a un lote existente;
    // un registro suelto siempre es nuevo).
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
          error: `No se pudo subir una foto: ${errorSubida.message}`,
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
      pct_arrugados,
      pct_otros_granos,
      pct_roido_picado,
      pct_humedad,
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
