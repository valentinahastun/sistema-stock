"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";

type Resultado = { ok: true } | { ok: false; error: string };

async function editor() {
  const u = await getUsuario();
  if (!u?.acceso || u.acceso.rol !== "editor") {
    throw new Error("Solo Lourdes y Valentina pueden editar Operaciones Comex.");
  }
  return u.email;
}

function refrescar(clave: string) {
  revalidatePath("/");
  revalidatePath("/operaciones");
  revalidatePath(`/operaciones/${encodeURIComponent(clave)}`);
}

// Marca (o corrige) un paso. Queda como cargado a mano: la sincronización
// con las planillas ya no lo pisa.
export async function marcarPaso(clave: string, paso: string, formData: FormData): Promise<Resultado> {
  try {
    const email = await editor();
    const fecha = String(formData.get("fecha") ?? "").trim();
    const detalle = String(formData.get("detalle") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Elegí la fecha." };

    const supabase = createClient();
    const { error } = await supabase.from("op_hitos").upsert(
      {
        clave,
        paso,
        fecha,
        fuente: "manual",
        detalle: detalle || null,
        updated_by: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clave,paso" }
    );
    if (error) return { ok: false, error: error.message };
    refrescar(clave);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function quitarPaso(clave: string, paso: string): Promise<Resultado> {
  try {
    await editor();
    const supabase = createClient();
    const { error } = await supabase.from("op_hitos").delete().eq("clave", clave).eq("paso", paso);
    if (error) return { ok: false, error: error.message };
    refrescar(clave);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cambiarResponsable(clave: string, responsable: string): Promise<Resultado> {
  try {
    await editor();
    if (responsable !== "lourdes" && responsable !== "valentina") {
      return { ok: false, error: "Responsable inválida." };
    }
    const supabase = createClient();
    const { error } = await supabase.from("op_operaciones").update({ responsable }).eq("clave", clave);
    if (error) return { ok: false, error: error.message };
    refrescar(clave);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// "Por confirmar": un mail que el sistema no pudo asignar solo.
export async function resolverMail(
  id: string,
  accion: "confirmar" | "descartar",
  clave: string | null,
  paso: string | null
): Promise<Resultado> {
  try {
    await editor();
    const supabase = createClient();
    const { error } = await supabase.rpc("op_resolver_mail", {
      p_id: id,
      p_accion: accion,
      p_clave: clave,
      p_paso: paso,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/por-confirmar");
    if (clave) refrescar(clave);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
