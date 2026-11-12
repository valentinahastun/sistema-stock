// Arribos a depósito: diferencia entre lo cargado y lo descargado
export const TOLERANCIA_ARRIBO_KG = 100;

export type MovArribo = {
  cantidad: number; // tn del egreso / directo
  cantidad_cargada_cp: number | null; // tn cargadas según la CPE confirmada (si se subió)
  cantidad_descargada: number | null;
  arribo_estado: string | null;
  reclamo_estado: string | null;
};

export type EstadoArribo = "en_viaje" | "ok" | "diferencia" | "no_aplica";

// kg que faltaron (positivo) o sobraron (negativo) en destino
export function difKg(m: MovArribo) {
  if (m.cantidad_descargada == null) return null;
  const cargado = m.cantidad_cargada_cp ?? m.cantidad;
  return Math.round((cargado - m.cantidad_descargada) * 1000);
}

export function estadoArribo(m: MovArribo): EstadoArribo {
  if (m.arribo_estado === "no_aplica") return "no_aplica";
  const d = difKg(m);
  if (d == null) return "en_viaje";
  return Math.abs(d) > TOLERANCIA_ARRIBO_KG ? "diferencia" : "ok";
}
