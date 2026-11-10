// Las salidas (egresos) se cargan por planta + producto, no sobre un lote.
// Para que el detalle muestre lo que queda en cada lote, se reparten entre
// los lotes procesados de esa planta/producto, del más viejo al más nuevo:
//  - con CV: primero los lotes de ese CV, después los del productor elegido
//    en el egreso, después los libres (sin CV) y por último cualquiera.
//  - sin CV: primero los lotes libres del productor, después cualquier lote
//    del productor, después los libres y por último cualquiera.
// Lo usan la pantalla de Stock y la carga de egresos (para sugerir el
// productor con el mismo stock que se ve en pantalla).

export type LoteReparto = {
  productor: string | null;
  estado: string;
  fecha_ingreso: string;
  stock_actual_tn: number;
  cv?: string | null;
  salidas_tn?: number;
  salidas?: { cv: string | null; tn: number }[];
};

export type EgresoReparto = {
  planta_id: string;
  producto_id: string;
  cantidad: number;
  cv: string | null;
  productor: string | null;
};

export function repartirEgresos<T extends LoteReparto>(
  lotesPorClave: Map<string, T[]>,
  egresos: EgresoReparto[]
) {
  const porClave = new Map<string, EgresoReparto[]>();
  egresos.forEach((e) => {
    const clave = `${e.planta_id}-${e.producto_id}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), e]);
  });

  porClave.forEach((lista, clave) => {
    const procesados = (lotesPorClave.get(clave) ?? [])
      .filter((l) => l.estado !== "natural")
      .sort((a, b) => (a.fecha_ingreso < b.fecha_ingreso ? -1 : 1));

    const descontar = (cantidad: number, cv: string | null, candidatos: T[]) => {
      let resto = cantidad;
      for (const l of candidatos) {
        if (resto <= 0) break;
        const sale = Math.min(resto, Math.max(l.stock_actual_tn, 0));
        if (sale <= 0) continue;
        l.stock_actual_tn -= sale;
        l.salidas_tn = (l.salidas_tn ?? 0) + sale;
        const salidas = (l.salidas = l.salidas ?? []);
        const ya = salidas.find((s) => s.cv === cv);
        if (ya) ya.tn += sale;
        else salidas.push({ cv, tn: sale });
        resto -= sale;
      }
      return resto;
    };

    const delProductor = (e: EgresoReparto) => (l: T) => !!e.productor && l.productor === e.productor;
    const salir = (e: EgresoReparto, filtros: ((l: T) => boolean)[]) => {
      let resto = e.cantidad;
      for (const f of filtros) {
        if (resto <= 0.0000001) break;
        resto = descontar(resto, e.cv, procesados.filter(f));
      }
    };

    lista
      .filter((e) => e.cv)
      .forEach((e) =>
        salir(e, [(l) => l.cv === e.cv, delProductor(e), (l: T) => !l.cv, () => true])
      );
    lista
      .filter((e) => !e.cv)
      .forEach((e) =>
        salir(e, [(l) => delProductor(e)(l) && !l.cv, delProductor(e), (l: T) => !l.cv, () => true])
      );
  });
}
