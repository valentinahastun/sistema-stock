"use server";
 
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { revalidatePath } from "next/cache";
 
type Resultado = { ok: true } | { ok: false; error: string };
 
// Guarda (o borra, si se manda vacío) el % de caída estimada de un lote.
// Es solo informativo: no crea ningún movimiento de stock. Solo se puede
// tocar en lotes "natural"; una vez procesado, la caída real ya quedó
// registrada como descarte y esta estimación deja de tener sentido.
export async function actualizarCaidaEstimada(
  loteId: string,
  pctTexto: string
): Promise<Resultado> {
  try {
    const perfil = await getPerfilActual();
    if (!perfil || perfil.rol !== "admin") {
      return { ok: false, error: "Solo el usuario administrador puede editarlo." };
    }
 
    let pct: number | null = null;
    if (pctTexto !== "" && pctTexto !== null && pctTexto !== undefined) {
      pct = Number(pctTexto);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        return { ok: false, error: "Tiene que ser un número entre 0 y 100." };
      }
    }
 
    const supabase = createClient();
 
    const { data: lote, error: errorLote } = await supabase
      .from("lotes")
      .select("id, estado")
      .eq("id", loteId)
      .single();
 
    if (errorLote || !lote) {
      return { ok: false, error: "No se encontró el lote." };
    }
    if (lote.estado !== "natural") {
      return {
        ok: false,
        error: "Este lote ya está procesado: no se puede estimar la caída.",
      };
    }
 
    const { error } = await supabase
      .from("lotes")
      .update({ caida_pct_estimada: pct })
      .eq("id", loteId);
 
    if (error) return { ok: false, error: error.message };
 
    revalidatePath("/stock");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
