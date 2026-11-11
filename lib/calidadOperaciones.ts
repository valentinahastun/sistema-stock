import { createClient } from "@/lib/supabase/server";
import { normalizarCv } from "@/lib/cv";

export type CalidadCv = { id: string; fecha: string; apto: boolean | null };

// CV de una operación, igual que se guarda en stock y calidad: "CV 26-124" / "CV 26-115 A"
export function cvDeOperacion(o: { cv: string; lote: string | null }) {
  return normalizarCv(`${o.cv}${o.lote ? " " + o.lote : ""}`);
}

// Análisis de calidad por CV (el más nuevo primero): los cargados con el CV
// y los vinculados a un lote que tiene ese CV.
export async function calidadPorCv(): Promise<Map<string, CalidadCv[]>> {
  const { data } = await createClient()
    .from("registros_calidad")
    .select("id, fecha, apto, numero_contrato, lotes(cv)")
    .order("fecha", { ascending: false });
  const mapa = new Map<string, CalidadCv[]>();
  (data ?? []).forEach((c: any) => {
    const lote = Array.isArray(c.lotes) ? c.lotes[0] : c.lotes;
    const cvs = new Set([normalizarCv(c.numero_contrato), lote?.cv ?? null].filter(Boolean) as string[]);
    cvs.forEach((cv) => mapa.set(cv, [...(mapa.get(cv) ?? []), { id: c.id, fecha: c.fecha, apto: c.apto }]));
  });
  return mapa;
}
