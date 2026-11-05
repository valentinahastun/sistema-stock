import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import StockAgrupado, { type LoteDetalle, type FilaBase } from "@/components/FilaStock";

export default async function StockPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const puedeEditar = perfil?.rol === "admin";

  const [{ data: plantas }, { data: productos }, { data: stock }, { data: comprometido }, { data: lotes }, { data: descartes }, { data: bolsas }, { data: egresos }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("stock_consolidado").select("*"),
      supabase.from("stock_comprometido").select("*"),
      supabase
        .from("stock_lotes")
        .select(
          "lote_id, planta_id, producto_id, productor, numero_cp, estado, fecha_ingreso, caida_pct_estimada, stock_actual_tn"
        )
        .order("fecha_ingreso", { ascending: false }),
      supabase.from("movimientos_stock").select("lote_id, cantidad").eq("tipo", "descarte"),
      supabase.from("lotes").select("id, cv, bolsas_25, bolsas_50, big_bags"),
      supabase.from("movimientos_stock").select("planta_id, producto_id, cantidad, cv").eq("tipo", "egreso").is("lote_id", null),
    ]);

  // Bolsas de cada lote (25 kg, 50 kg, big bags)
  const bolsasPorLote = new Map<string, { cv: string | null; bolsas_25: number | null; bolsas_50: number | null; big_bags: number | null }>();
  (bolsas ?? []).forEach((b: any) => bolsasPorLote.set(b.id, b));

  // Descarte real ya cargado en cada lote (para los lotes procesados)
  const descartePorLote = new Map<string, number>();
  (descartes ?? []).forEach((d: any) => {
    descartePorLote.set(d.lote_id, (descartePorLote.get(d.lote_id) ?? 0) + Number(d.cantidad));
  });

  const lotesPorClave = new Map<string, LoteDetalle[]>();
  (lotes ?? []).forEach((l: any) => {
    const clave = `${l.planta_id}-${l.producto_id}`;
    const lista = lotesPorClave.get(clave) ?? [];
    lista.push({
      lote_id: l.lote_id,
      productor: l.productor,
      numero_cp: l.numero_cp,
      estado: l.estado,
      fecha_ingreso: l.fecha_ingreso,
      stock_actual_tn: Number(l.stock_actual_tn),
      caida_pct_estimada: l.caida_pct_estimada === null ? null : Number(l.caida_pct_estimada),
      descarte_real_tn: descartePorLote.get(l.lote_id) ?? 0,
      bolsas_25: bolsasPorLote.get(l.lote_id)?.bolsas_25 ?? null,
      bolsas_50: bolsasPorLote.get(l.lote_id)?.bolsas_50 ?? null,
      big_bags: bolsasPorLote.get(l.lote_id)?.big_bags ?? null,
      cv: bolsasPorLote.get(l.lote_id)?.cv ?? null,
    });
    lotesPorClave.set(clave, lista);
  });

  // Las salidas (egresos) se cargan por planta + producto, no sobre un lote.
  // Para que el detalle muestre lo que queda en cada lote, se reparten entre
  // los lotes procesados: las que tienen CV, en los lotes de ese CV; las demás,
  // primero en los lotes libres y después en el resto, del más viejo al más nuevo.
  const egresosPorClave = new Map<string, { cantidad: number; cv: string | null }[]>();
  (egresos ?? []).forEach((e: any) => {
    const clave = `${e.planta_id}-${e.producto_id}`;
    const lista = egresosPorClave.get(clave) ?? [];
    lista.push({ cantidad: Number(e.cantidad), cv: e.cv ?? null });
    egresosPorClave.set(clave, lista);
  });
  egresosPorClave.forEach((lista, clave) => {
    const procesados = (lotesPorClave.get(clave) ?? [])
      .filter((l) => l.estado !== "natural")
      .sort((a, b) => (a.fecha_ingreso < b.fecha_ingreso ? -1 : 1));
    const descontar = (cantidad: number, candidatos: LoteDetalle[]) => {
      let resto = cantidad;
      for (const l of candidatos) {
        if (resto <= 0) break;
        const sale = Math.min(resto, Math.max(l.stock_actual_tn, 0));
        l.stock_actual_tn -= sale;
        l.salidas_tn = (l.salidas_tn ?? 0) + sale;
        resto -= sale;
      }
      return resto;
    };
    lista.filter((e) => e.cv).forEach((e) => {
      const resto = descontar(e.cantidad, procesados.filter((l) => l.cv === e.cv));
      if (resto > 0) descontar(resto, procesados);
    });
    lista.filter((e) => !e.cv).forEach((e) => {
      const resto = descontar(e.cantidad, procesados.filter((l) => !l.cv));
      if (resto > 0) descontar(resto, procesados);
    });
  });

  const comprometidoPorClave = new Map<string, number>();
  (comprometido ?? []).forEach((c) => {
    comprometidoPorClave.set(
      `${c.planta_id}-${c.producto_id}`,
      Number(c.toneladas_comprometidas)
    );
  });

  let filas: FilaBase[] = (stock ?? []).map((s) => {
    const clave = `${s.planta_id}-${s.producto_id}`;
    const comprometidoTn = comprometidoPorClave.get(clave) ?? 0;
    const stockDisponibleTn = Number(s.stock_disponible_tn);
    return {
      planta_id: s.planta_id,
      planta: s.planta,
      producto_id: s.producto_id,
      producto: s.producto,
      stockDisponibleTn,
      comprometidoTn,
      libreTn: stockDisponibleTn - comprometidoTn,
    };
  });

  if (searchParams.planta_id) {
    filas = filas.filter((f) => f.planta_id === searchParams.planta_id);
  }
  if (searchParams.producto_id) {
    filas = filas.filter((f) => f.producto_id === searchParams.producto_id);
  }

  const totalDisponible = filas.reduce((acc, f) => acc + f.stockDisponibleTn, 0);

  const paramsExport = new URLSearchParams();
  if (searchParams.planta_id) paramsExport.set("planta_id", searchParams.planta_id);
  if (searchParams.producto_id) paramsExport.set("producto_id", searchParams.producto_id);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <div className="flex items-center justify-between mb-4 mt-2">
        <h1 className="text-xl font-semibold text-brand-navy">Stock consolidado</h1>
        <a
          href={`/api/export?${paramsExport.toString()}`}
          className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5"
        >
          Exportar a Excel
        </a>
      </div>

      <FiltroStock
        plantas={plantas ?? []}
        productos={productos ?? []}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/stock"
      />

      <div className="mt-4">
        <StockAgrupado
          filas={filas}
          lotesPorClave={lotesPorClave}
          puedeEditar={puedeEditar}
        />
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Total disponible: {totalDisponible.toFixed(2)} tn
      </p>
      <p className="text-xs text-gray-400 mt-1">
        Hacé clic en una planta (o un producto, según cómo estés agrupando)
        para desplegar el detalle. Ahí adentro, hacé clic en cada producto
        para ver el detalle por lote. En los lotes "natural" podés poner el
        % de caída y confirmarlo: eso carga el descarte real sobre ese lote
        (que pasa a "procesado") y da de alta, como stock propio, el ingreso
        del producto de descarte correspondiente (por ejemplo Descarte
        Negro). Si te equivocaste de %, podés borrar ese descarte desde
        Movimientos y el lote vuelve a quedar "natural" para volver a
        intentarlo.
      </p>
    </div>
  );
}

