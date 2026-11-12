import { createClient } from "@/lib/supabase/server";
import { normalizarCv } from "@/lib/cv";

// Valores de calidad que se promedian en las caladas (en el orden en que se muestran)
export const PARAMETROS_CALADA = [
  ["pct_humedad", "Humedad"],
  ["pct_partidos", "Partidos"],
  ["pct_tegumento_danado", "Tegumento dañado"],
  ["pct_levemente_manchados", "Lev. manchados"],
  ["pct_manchados", "Manchados"],
  ["pct_arrugados", "Arrugados"],
  ["pct_otros_defectos_graves", "Otros def. graves"],
  ["pct_otros_defectos_leves", "Otros def. leves"],
  ["pct_materia_extrana", "Materia extraña"],
  ["pct_bajo_zaranda", "Bajo zaranda"],
] as const;
const DANOS = [
  "pct_partidos",
  "pct_tegumento_danado",
  "pct_levemente_manchados",
  "pct_manchados",
  "pct_arrugados",
  "pct_otros_defectos_graves",
  "pct_otros_defectos_leves",
];

export type CalidadCv = { id: string; fecha: string; apto: boolean | null };
export type Calada = {
  id: string;
  fecha: string;
  hora: string | null;
  numero_cp: string;
  patente: string | null;
  valores: Record<string, number | null>; // por parámetro, más "danos_totales"
};
export type CalidadOperacion = { analisis: CalidadCv[]; caladas: Calada[] };

// CV de una operación, igual que se guarda en stock y calidad: "CV 26-124" / "CV 26-115 A"
export function cvDeOperacion(o: { cv: string; lote: string | null }) {
  return normalizarCv(`${o.cv}${o.lote ? " " + o.lote : ""}`);
}

// Calidad por CV: los análisis (el más nuevo primero; cargados con el CV o
// vinculados a un lote con ese CV) y las caladas de los camiones de la carga.
export async function calidadPorCv(): Promise<Map<string, CalidadOperacion>> {
  const { data } = await createClient()
    .from("registros_calidad")
    .select(`id, fecha, created_at, apto, numero_contrato, numero_cp, patente, lotes(cv), ${PARAMETROS_CALADA.map((p) => p[0]).join(", ")}`)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });
  const mapa = new Map<string, CalidadOperacion>();
  const de = (cv: string) => {
    if (!mapa.has(cv)) mapa.set(cv, { analisis: [], caladas: [] });
    return mapa.get(cv)!;
  };
  (data ?? []).forEach((c: any) => {
    const lote = Array.isArray(c.lotes) ? c.lotes[0] : c.lotes;
    const cvs = new Set([normalizarCv(c.numero_contrato), lote?.cv ?? null].filter(Boolean) as string[]);
    if (c.numero_cp) {
      const valores: Record<string, number | null> = {};
      PARAMETROS_CALADA.forEach(([k]) => (valores[k] = c[k] == null ? null : Number(c[k])));
      const danos = DANOS.map((k) => valores[k]).filter((v): v is number => v != null);
      valores.danos_totales = danos.length ? danos.reduce((s, v) => s + v, 0) : null;
      const calada: Calada = {
        id: c.id,
        fecha: c.fecha,
        hora: c.created_at
          ? new Date(c.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })
          : null,
        numero_cp: c.numero_cp,
        patente: c.patente,
        valores,
      };
      cvs.forEach((cv) => de(cv).caladas.push(calada));
    } else {
      cvs.forEach((cv) => de(cv).analisis.push({ id: c.id, fecha: c.fecha, apto: c.apto }));
    }
  });
  return mapa;
}

// Promedio de cada parámetro sobre las caladas que lo tienen cargado
export function promedioCaladas(caladas: Calada[]) {
  const claves = [...PARAMETROS_CALADA.map((p) => p[0] as string), "danos_totales"];
  const r: Record<string, { valor: number; n: number } | null> = {};
  claves.forEach((k) => {
    const vs = caladas.map((c) => c.valores[k]).filter((v): v is number => v != null);
    r[k] = vs.length ? { valor: vs.reduce((s, v) => s + v, 0) / vs.length, n: vs.length } : null;
  });
  return r;
}
