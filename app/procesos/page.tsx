import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import { type ProcesoVista } from "@/components/TarjetaProceso";
import ProcesosPorPlanta from "@/components/ProcesosPorPlanta";
import { tn, TIPOS_DESCARTE } from "@/lib/procesos";

export const dynamic = "force-dynamic";

type Rel = { nombre: string }[] | { nombre: string } | null;
const nombreDe = (rel: Rel) => (!rel ? "" : Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre);
const uno = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);

export default async function ProcesosPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const puedeEditar = perfil?.rol === "admin";

  let consulta = supabase
    .from("procesos")
    .select(
      "id, numero, cv, estado, fecha_inicio, fecha_fin, entrada_tn, procesado_tn, descarte_tn, bolsas_25, bolsas_50, big_bags, segundilla_tn, desc_electronica_tn, desc_vibradora_tn, desc_clasificadora_tn, desc_inutilizable_tn, volatil_tn, historico, productores_texto, observaciones, planta_id, producto_id, plantas(nombre), productos(nombre), proceso_entradas(cantidad, lotes(proceso_id, productores(nombre)))"
    )
    .order("fecha_inicio", { ascending: false })
    .limit(300);
  if (searchParams.planta_id) consulta = consulta.eq("planta_id", searchParams.planta_id);
  if (searchParams.producto_id) consulta = consulta.eq("producto_id", searchParams.producto_id);

  const [{ data: plantas }, { data: productos }, { data: procesos, error }, { data: todas }] = await Promise.all([
    supabase.from("plantas").select("id, nombre").order("nombre"),
    supabase.from("productos").select("id, nombre").order("nombre"),
    consulta,
    // Para saber qué salió de cada proceso y volvió a entrar en otro
    supabase.from("proceso_entradas").select("proceso_id, procesos(numero), lotes(proceso_id)"),
  ]);

  const numeroDe = new Map<string, string | null>();
  (procesos ?? []).forEach((p: any) => numeroDe.set(p.id, p.numero));

  const reprocesadoEn = new Map<string, Set<string>>();
  (todas ?? []).forEach((e: any) => {
    const origen = uno<any>(e.lotes)?.proceso_id;
    if (!origen) return;
    const s = reprocesadoEn.get(origen) ?? new Set<string>();
    s.add(uno<any>(e.procesos)?.numero ?? "sin número");
    reprocesadoEn.set(origen, s);
  });

  const vistas: ProcesoVista[] = (procesos ?? []).map((p: any) => {
    const entradas = (p.proceso_entradas ?? []) as any[];
    const productores = p.historico
      ? (p.productores_texto ?? "").split(",").map((x: string) => x.trim()).filter(Boolean)
      : Array.from(new Set(entradas.map((e) => nombreDe(uno<any>(e.lotes)?.productores)).filter(Boolean))) as string[];
    const vieneDe = Array.from(
      new Set(entradas.map((e) => uno<any>(e.lotes)?.proceso_id).filter(Boolean) as string[])
    ).map((id) => numeroDe.get(id) ?? "sin número") as string[];
    return {
      id: p.id,
      numero: p.numero,
      planta: nombreDe(p.plantas),
      producto: nombreDe(p.productos),
      cv: p.cv,
      estado: p.estado,
      fecha_inicio: p.fecha_inicio,
      fecha_fin: p.fecha_fin,
      entrada_tn: Number(p.entrada_tn),
      procesado_tn: p.procesado_tn === null ? null : Number(p.procesado_tn),
      descarte_tn: p.descarte_tn === null ? null : Number(p.descarte_tn),
      bolsas_25: p.bolsas_25,
      bolsas_50: p.bolsas_50,
      big_bags: p.big_bags,
      descartes: [
        ...TIPOS_DESCARTE.map((t) => ({ nombre: t.nombre, tn: Number(p[t.campo] ?? 0) })),
        { nombre: "Volátil", tn: Number(p.volatil_tn ?? 0) },
      ].filter((d) => d.tn > 0),
      historico: p.historico,
      observaciones: p.observaciones,
      productores,
      lotes: entradas.length,
      viene_de: vieneDe,
      reprocesado_en: Array.from(reprocesadoEn.get(p.id) ?? []),
    };
  });

  const enCurso = vistas.filter((v) => v.estado === "en_proceso");
  const terminados = vistas
    .filter((v) => v.estado === "terminado")
    .sort((a, b) => ((b.fecha_fin ?? b.fecha_inicio) > (a.fecha_fin ?? a.fecha_inicio) ? 1 : -1));

  const entradaTerm = terminados.reduce((s, v) => s + v.entrada_tn, 0);
  const procTerm = terminados.reduce((s, v) => s + (v.procesado_tn ?? 0), 0);
  const descTerm = terminados.reduce((s, v) => s + (v.descarte_tn ?? 0), 0);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Inicio
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 mt-2">
        <h1 className="text-xl font-semibold text-brand-navy">Procesos</h1>
        {puedeEditar && (
          <Link
            href="/procesos/nuevo"
            className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5"
          >
            + Nuevo proceso
          </Link>
        )}
      </div>

      <FiltroStock
        plantas={plantas ?? []}
        productos={(productos ?? []).filter((p) => !/^descarte/i.test(p.nombre))}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/procesos"
      />

      {error && <p className="text-sm text-red-600 mt-4">No se pudieron leer los procesos: {error.message}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        <div className="rounded-lg bg-sky-50 p-3">
          <div className="text-xs text-sky-700">En proceso ahora</div>
          <div className="text-xl font-semibold text-sky-800">{tn(enCurso.reduce((s, v) => s + v.entrada_tn, 0), 1)} tn</div>
          <div className="text-xs text-sky-700">{enCurso.length} procesos</div>
        </div>
        <div className="rounded-lg bg-brand-green-light p-3">
          <div className="text-xs text-brand-green-dark">Rinde promedio</div>
          <div className="text-xl font-semibold text-brand-green-dark">
            {entradaTerm > 0 ? `${tn((procTerm / entradaTerm) * 100, 1)}%` : "—"}
          </div>
          <div className="text-xs text-brand-green-dark">{terminados.length} procesos terminados</div>
        </div>
        <div className="rounded-lg bg-amber-50 p-3 col-span-2 sm:col-span-1">
          <div className="text-xs text-amber-700">Descarte total</div>
          <div className="text-xl font-semibold text-amber-800">{tn(descTerm, 1)} tn</div>
          <div className="text-xs text-amber-700">de {tn(entradaTerm, 1)} tn que entraron</div>
        </div>
      </div>

      <div className="mt-6">
        <ProcesosPorPlanta procesos={vistas} puedeEditar={puedeEditar} />
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Hacé clic en una planta para ver sus procesos. Los totales de entró, procesado, descarte y rinde son de los procesos terminados.
      </p>
    </div>
  );
}
