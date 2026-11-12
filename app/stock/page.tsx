import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import StockAgrupado, { type LoteDetalle, type FilaBase } from "@/components/FilaStock";
import { repartirEgresos } from "@/lib/repartoEgresos";
import { normalizarCv } from "@/lib/cv";

export default async function StockPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const puedeEditar = perfil?.rol === "admin";

  const [{ data: plantas }, { data: productos }, { data: stock }, { data: comprometido }, { data: lotes }, { data: descartes }, { data: bolsas }, { data: egresos }, { data: aProceso }, { data: enProceso }, { data: calidades }] =
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
      supabase.from("lotes").select("id, cv, bolsas_25, bolsas_50, big_bags, tipo_descarte, proceso_id, procesos!lotes_proceso_id_fkey(numero)"),
      supabase.from("movimientos_stock").select("planta_id, producto_id, cantidad, cv, bolsas_25, bolsas_50, big_bags, productores(nombre)").eq("tipo", "egreso").is("lote_id", null),
      // Lo que entró de cada lote a un proceso
      supabase.from("proceso_entradas").select("lote_id, cantidad, procesos(numero)"),
      supabase
        .from("procesos")
        .select("id, numero, entrada_tn, fecha_inicio, planta_id, producto_id, plantas(nombre), productos(nombre)")
        .eq("estado", "en_proceso")
        .order("fecha_inicio"),
      supabase
        .from("registros_calidad")
        .select("id, fecha, apto, lote_id, planta_id, producto_id, numero_contrato, productores(nombre)")
        .is("numero_cp", null) // las caladas de camiones se ven en la operación, no en cada lote
        .order("fecha", { ascending: false }),
    ]);

  const numeroDe = (rel: any) => (Array.isArray(rel) ? rel[0]?.numero : rel?.numero) ?? "sin número";
  const nombreRel = (rel: any) => (Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre) ?? "";
  const aProcesoPorLote = new Map<string, { proceso: string; tn: number }[]>();
  (aProceso ?? []).forEach((e: any) => {
    const lista = aProcesoPorLote.get(e.lote_id) ?? [];
    lista.push({ proceso: numeroDe(e.procesos), tn: Number(e.cantidad) });
    aProcesoPorLote.set(e.lote_id, lista);
  });

  // Bolsas de cada lote (25 kg, 50 kg, big bags)
  const bolsasPorLote = new Map<string, { cv: string | null; bolsas_25: number | null; bolsas_50: number | null; big_bags: number | null; tipo_descarte: string | null; proceso_id: string | null; procesos: any }>();
  (bolsas ?? []).forEach((b: any) => bolsasPorLote.set(b.id, b));

  // Descarte real ya cargado en cada lote (para los lotes procesados)
  const descartePorLote = new Map<string, number>();
  (descartes ?? []).forEach((d: any) => {
    descartePorLote.set(d.lote_id, (descartePorLote.get(d.lote_id) ?? 0) + Number(d.cantidad));
  });

  const lotesPorClave = new Map<string, LoteDetalle[]>();
  (lotes ?? []).forEach((l: any) => {
    const clave = `${l.planta_id}-${l.producto_id}`;
    const aProc = aProcesoPorLote.get(l.lote_id);
    // Un lote que entró entero a un proceso ya no se muestra (está en el proceso)
    if (aProc && Number(l.stock_actual_tn) <= 0.0005) return;
    const extra = bolsasPorLote.get(l.lote_id);
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
      de_proceso: extra?.proceso_id ? numeroDe(extra.procesos) : null,
      a_proceso: aProc ?? [],
      tipo_descarte: extra?.tipo_descarte ?? null,
    });
    lotesPorClave.set(clave, lista);
  });

  // Calidad de cada lote: el análisis vinculado al lote, los cargados con el
  // CV del lote y los (sin vincular y sin CV) del mismo productor en esa
  // planta/producto.
  const calidadesSueltas = (calidades ?? []).map((c: any) => ({
    id: c.id as string,
    fecha: c.fecha as string,
    apto: c.apto as boolean | null,
    lote_id: c.lote_id as string | null,
    clave: `${c.planta_id}-${c.producto_id}`,
    cv: normalizarCv(c.numero_contrato),
    productor: (Array.isArray(c.productores) ? c.productores[0]?.nombre : c.productores?.nombre) ?? null,
  }));
  lotesPorClave.forEach((lista, clave) =>
    lista.forEach((l) => {
      const vistas = new Set<string>();
      const res: NonNullable<LoteDetalle["calidades"]> = [];
      const sumar = (c: (typeof calidadesSueltas)[number], por: "lote" | "cv" | "productor") => {
        if (vistas.has(c.id)) return;
        vistas.add(c.id);
        res.push({ id: c.id, fecha: c.fecha, apto: c.apto, por });
      };
      calidadesSueltas.filter((c) => c.lote_id === l.lote_id).forEach((c) => sumar(c, "lote"));
      if (l.cv) calidadesSueltas.filter((c) => c.cv && c.cv === l.cv).forEach((c) => sumar(c, "cv"));
      calidadesSueltas
        // Por productor solo los análisis sin CV: uno con CV va únicamente a los lotes de ese CV
        .filter((c) => !c.lote_id && !c.cv && c.clave === clave && c.productor && c.productor === l.productor)
        .forEach((c) => sumar(c, "productor"));
      if (res.length) l.calidades = res.slice(0, 3);
    })
  );

  // Salidas (egresos) repartidas entre los lotes: ver lib/repartoEgresos.ts
  repartirEgresos(
    lotesPorClave,
    (egresos ?? []).map((e: any) => ({
      planta_id: e.planta_id,
      producto_id: e.producto_id,
      cantidad: Number(e.cantidad),
      cv: e.cv ?? null,
      productor: (Array.isArray(e.productores) ? e.productores[0]?.nombre : e.productores?.nombre) ?? null,
      bolsas_25: e.bolsas_25,
      bolsas_50: e.bolsas_50,
      big_bags: e.big_bags,
    }))
  );

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
        ← Inicio
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

      {(enProceso ?? []).length > 0 && (
        <div className="mt-4 rounded-lg bg-sky-50 border border-sky-100 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-sky-800">En proceso ahora</span>
            <Link href="/procesos" className="text-xs text-sky-700 underline">
              Ver procesos
            </Link>
          </div>
          <p className="text-xs text-sky-700 mb-2">
            Esto salió del stock natural y vuelve como procesado y descarte cuando se cierra el proceso.
          </p>
          <ul className="text-sm text-sky-900 space-y-0.5">
            {(enProceso ?? []).map((p: any) => (
              <li key={p.id}>
                {p.numero ? `Proceso ${p.numero}` : "Proceso sin número"} · {nombreRel(p.productos)} · {nombreRel(p.plantas)}:{" "}
                <b>{Number(p.entrada_tn).toLocaleString("es-AR", { maximumFractionDigits: 2 })} tn</b>
              </li>
            ))}
          </ul>
        </div>
      )}

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

