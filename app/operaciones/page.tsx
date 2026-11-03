import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import FiltroResponsable from "@/components/FiltroResponsable";
import Etapas from "@/components/Etapas";
import {
  type Alerta,
  type Hito,
  type Operacion,
  ETAPAS,
  enPalabras,
  etapas,
  fecha,
  nombreOperacion,
  NOMBRE_RESPONSABLE,
} from "@/lib/pasos";

export const dynamic = "force-dynamic";

export default async function Operaciones({
  searchParams,
}: {
  searchParams: { resp?: string; q?: string; etapa?: string };
}) {
  const u = await getUsuario();
  if (!u) return null;
  if (!u.acceso) return <SinAcceso email={u.email} />;

  const resp = searchParams.resp ?? "todas";
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const etapaSel = searchParams.etapa ?? "";
  const supabase = createClient();

  const [{ data: ops }, { data: hitos }, { data: alertas }] = await Promise.all([
    supabase.from("op_operaciones").select("*").eq("activa", true).order("clave"),
    supabase.from("op_hitos").select("clave, paso, fecha, fuente, detalle, mail_url, updated_by"),
    supabase.rpc("op_alertas"),
  ]);

  const porOp = new Map<string, Map<string, Hito>>();
  ((hitos ?? []) as Hito[]).forEach((h) => {
    if (!porOp.has(h.clave)) porOp.set(h.clave, new Map());
    porOp.get(h.clave)!.set(h.paso, h);
  });
  const alertasPorOp = new Map<string, Alerta[]>();
  ((alertas ?? []) as Alerta[]).forEach((a) => {
    alertasPorOp.set(a.clave, [...(alertasPorOp.get(a.clave) ?? []), a]);
  });

  let base = (ops ?? []) as Operacion[];
  if (resp !== "todas") base = base.filter((o) => o.responsable === resp);
  if (q) {
    base = base.filter((o) =>
      [o.clave, o.cv, o.cliente, o.destino, o.producto, o.booking].some((x) => (x ?? "").toLowerCase().includes(q))
    );
  }

  const filas = base.map((o) => {
    const h = porOp.get(o.clave) ?? new Map<string, Hito>();
    const et = etapas(o, h);
    const actual = et.find((e) => e.estado === "actual");
    const al = alertasPorOp.get(o.clave) ?? [];
    return { o, et, etapaActual: actual?.codigo ?? "terminada", ahora: enPalabras(o, h), al };
  });

  // Cuántas hay en cada etapa (para los recuadros de arriba)
  const cuenta = new Map<string, number>();
  filas.forEach((f) => cuenta.set(f.etapaActual, (cuenta.get(f.etapaActual) ?? 0) + 1));

  const lista = (etapaSel ? filas.filter((f) => f.etapaActual === etapaSel) : filas).sort((a, b) => {
    // Primero las que tienen algo vencido, después por ETA
    const va = a.al.some((x) => x.nivel === "vencida") ? 0 : 1;
    const vb = b.al.some((x) => x.nivel === "vencida") ? 0 : 1;
    if (va !== vb) return va - vb;
    return (a.o.eta ?? "9999") < (b.o.eta ?? "9999") ? -1 : 1;
  });

  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ resp, ...(q ? { q } : {}), ...extra });
    return `/operaciones?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Operaciones abiertas</h1>
          <p className="text-sm text-gray-500">
            Cada operación es una venta (CV). La barra muestra en qué etapa está, del contrato al cobro.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/operaciones" className="flex">
            <input type="hidden" name="resp" value={resp} />
            <input
              name="q"
              defaultValue={searchParams.q ?? ""}
              placeholder="Buscar CV, cliente, destino…"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-60"
            />
          </form>
          <FiltroResponsable base="/operaciones" actual={resp} extra={q ? { q } : {}} />
        </div>
      </div>

      {/* Cuántas operaciones hay en cada etapa */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ETAPAS.map((e) => {
          const n = cuenta.get(e.codigo) ?? 0;
          const activo = etapaSel === e.codigo;
          return (
            <Link
              key={e.codigo}
              href={activo ? link({}) : link({ etapa: e.codigo })}
              className={
                "rounded-lg border p-3 text-center transition " +
                (activo ? "bg-brand-navy text-white border-brand-navy" : "bg-white hover:border-brand-navy")
              }
            >
              <div className="text-2xl" aria-hidden="true">{e.icono}</div>
              <div className={"text-2xl font-semibold " + (activo ? "" : "text-brand-navy")}>{n}</div>
              <div className={"text-xs " + (activo ? "text-gray-200" : "text-gray-500")}>{e.nombre}</div>
            </Link>
          );
        })}
      </div>
      {etapaSel && (
        <p className="text-sm">
          Mostrando solo las que están en <b>{ETAPAS.find((e) => e.codigo === etapaSel)?.nombre}</b>.{" "}
          <Link href={link({})} className="underline text-brand-navy">Ver todas</Link>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map(({ o, et, ahora, al }) => {
          const vencidas = al.filter((a) => a.nivel === "vencida");
          const proximas = al.filter((a) => a.nivel === "proxima");
          return (
            <Link
              key={o.clave}
              href={`/operaciones/${encodeURIComponent(o.clave)}`}
              className={
                "block bg-white rounded-lg shadow p-4 border-l-4 hover:shadow-md transition " +
                (vencidas.length ? "border-red-500" : proximas.length ? "border-amber-400" : "border-brand-green")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-brand-navy">{nombreOperacion(o)}</div>
                  <div className="text-sm text-gray-700 truncate" title={o.cliente ?? ""}>{o.cliente ?? "Cliente sin cargar"}</div>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {o.responsable ? NOMBRE_RESPONSABLE[o.responsable] : "Sin asignar"}
                </span>
              </div>

              <div className="text-xs text-gray-500 mt-1 truncate">
                {[o.producto, o.tn ? `${Number(o.tn)} tn` : null].filter(Boolean).join(" · ") || "—"}
                {" → "}
                {o.destino ?? "destino sin cargar"}
              </div>

              <div className="mt-3">
                <Etapas etapas={et} chica alerta={vencidas.length > 0} />
              </div>

              <div className={"mt-2 text-sm " + (vencidas.length ? "text-red-700 font-medium" : "text-gray-800")}>
                {vencidas.length ? "⚠ " + vencidas[0].mensaje : ahora}
              </div>
              {!vencidas.length && proximas.length > 0 && (
                <div className="text-xs text-amber-700 mt-0.5">⏰ {proximas[0].mensaje}</div>
              )}

              <div className="flex justify-between text-xs text-gray-500 mt-3 pt-2 border-t">
                <span>Sale: {o.etd ? fecha(o.etd) : "—"}</span>
                <span>Llega: {o.eta ? fecha(o.eta) : "—"}</span>
              </div>
            </Link>
          );
        })}
        {lista.length === 0 && (
          <p className="text-gray-400 text-sm col-span-full text-center py-6">No hay operaciones para este filtro.</p>
        )}
      </div>
    </div>
  );
}
