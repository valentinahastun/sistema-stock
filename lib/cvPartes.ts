// Reparto por CV de un lote (CP) cubierto por compras de la solapa COMPRAS:
// cada parte cubierta va al CV de la compra que la cubre y lo que no cubre
// ninguna compra va al CV propio de la CP. Si la CP ya bajó (caída, proceso,
// traslado), cada parte baja en la misma proporción. Igual que la vista
// stock_comprometido_cv de la base.

export type Cubierto = { lote_id: string; lote_cp_id: string | null; cantidad: number | string };
export type ParteCv = { cv: string | null; tn: number };

export function armarCubiertoPorCp(cubiertos: Cubierto[], cvDeLote: Map<string, string | null>) {
  const porCp = new Map<string, ParteCv[]>();
  cubiertos.forEach((c) => {
    if (!c.lote_cp_id) return;
    const lista = porCp.get(c.lote_cp_id) ?? [];
    lista.push({ cv: cvDeLote.get(c.lote_id) ?? null, tn: Number(c.cantidad) });
    porCp.set(c.lote_cp_id, lista);
  });
  return porCp;
}

// undefined si el lote no está cubierto por compras
export function partesCvDeLote(
  l: { lote_id: string; cantidad_ingresada: number | string | null; stock_actual_tn: number | string; cv: string | null },
  cubiertoPorCp: Map<string, ParteCv[]>
): ParteCv[] | undefined {
  const cub = cubiertoPorCp.get(l.lote_id);
  const ingresada = Number(l.cantidad_ingresada);
  if (!cub || !(ingresada > 0)) return undefined;
  const factor = Math.max(Number(l.stock_actual_tn), 0) / ingresada;
  const cubiertoTn = cub.reduce((a, c) => a + c.tn, 0);
  const partes = [...cub, { cv: l.cv, tn: Math.max(ingresada - cubiertoTn, 0) }];
  const porCv = new Map<string, number>();
  partes.forEach((p) => porCv.set(p.cv ?? "", (porCv.get(p.cv ?? "") ?? 0) + p.tn * factor));
  return Array.from(porCv, ([cv, tn]) => ({ cv: cv || null, tn })).filter((p) => p.tn > 0.0005);
}
