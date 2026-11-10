"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";

type Resultado = { ok: true; id?: string } | { ok: false; error: string };

export type EntradaProceso = { lote_id: string; cantidad: number };

export type NuevoProceso = {
  numero: string;
  planta_id: string;
  producto_id: string;
  cv: string;
  fecha_inicio: string;
  observaciones: string;
  entradas: EntradaProceso[];
};

import type { ValoresCierre as CierreProceso } from "@/lib/procesos";

function refrescar() {
  ["/procesos", "/stock", "/", "/movimientos"].forEach((p) => revalidatePath(p));
}

// "26-130", "130" o "cv 26-130 a" -> "CV 26-130 A"
function normalizarCv(texto: string): string | null {
  const t = texto.trim().toUpperCase();
  if (!t) return null;
  return t
    .split(/\s*[,/]\s*/)
    .map((p) => {
      const m = p.replace(/^CV\s*/, "").match(/^(?:(\d{2})\s*-\s*)?0*(\d{1,3})\s*([A-Z])?$/);
      if (!m) return p;
      return `CV ${m[1] ?? "26"}-${m[2].padStart(3, "0")}${m[3] ? " " + m[3] : ""}`;
    })
    .join(", ");
}

// La base devuelve el mensaje en castellano (raise exception): se muestra tal cual.
function mensaje(error: { message: string }) {
  return error.message.replace(/^.*?ERROR:\s*/, "");
}

async function admin() {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") throw new Error("Solo el usuario administrador puede cargar procesos.");
}

export async function crearProceso(p: NuevoProceso, cierre: CierreProceso | null): Promise<Resultado> {
  try {
    await admin();
    const supabase = createClient();
    const { data: id, error } = await supabase.rpc("proceso_abrir", {
      p: { ...p, cv: normalizarCv(p.cv) },
    });
    if (error) return { ok: false, error: mensaje(error) };
    if (cierre) {
      const { error: e2 } = await supabase.rpc("proceso_cerrar", { p_id: id, p: cierre });
      if (e2) {
        refrescar();
        return { ok: false, error: `El proceso quedó guardado "en proceso", pero no se pudo cerrar: ${mensaje(e2)}` };
      }
    }
    refrescar();
    return { ok: true, id: id as string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function cerrarProceso(id: string, cierre: CierreProceso): Promise<Resultado> {
  try {
    await admin();
    const { error } = await createClient().rpc("proceso_cerrar", { p_id: id, p: cierre });
    if (error) return { ok: false, error: mensaje(error) };
    refrescar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deshacerCierre(id: string): Promise<Resultado> {
  try {
    await admin();
    const { error } = await createClient().rpc("proceso_deshacer_cierre", { p_id: id });
    if (error) return { ok: false, error: mensaje(error) };
    refrescar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function eliminarProceso(id: string): Promise<Resultado> {
  try {
    await admin();
    const { error } = await createClient().rpc("proceso_eliminar", { p_id: id });
    if (error) return { ok: false, error: mensaje(error) };
    refrescar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
