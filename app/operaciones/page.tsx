import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import FiltroResponsable from "@/components/FiltroResponsable";
import TablaOperaciones from "@/components/TablaOperaciones";
import {
  type Alerta,
  type Hito,
  type Operacion,
  ETAPAS,
  enPalabras,
  etapas,
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
          <h1 className="text-xl font-semibold text-slate-800">Operaciones abiertas</h1>
          <p className="text-sm text-slate-500">
            Cada operación es una venta (CV). Los puntos muestran en qué etapa está: verde ✓ listo, círculo azul en curso, rojo atrasado.
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
      <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-2 flex flex-wrap">
        {ETAPAS.map((e, i) => {
          const n = cuenta.get(e.codigo) ?? 0;
          const activo = etapaSel === e.codigo;
          return (
            <Link
              key={e.codigo}
              href={activo ? link({}) : link({ etapa: e.codigo })}
              className={
                "flex-1 min-w-[120px] flex items-center gap-3 rounded-xl px-3 py-2.5 transition " +
                (activo ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50")
              }
            >
              <span className="w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center text-base shrink-0" aria-hidden="true">
                {e.icono}
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-semibold text-slate-800">{n}</span>
                <span className="block text-[11px] text-slate-500">
                  <span className="text-slate-300">{i + 1}.</span> {e.nombre}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      {etapaSel && (
        <p className="text-sm text-slate-600">
          Mostrando solo las que están en <b>{ETAPAS.find((e) => e.codigo === etapaSel)?.nombre}</b> ·{" "}
          <Link href={link({})} className="underline text-sky-700">ver todas</Link>
        </p>
      )}

      <TablaOperaciones filas={lista} />
    </div>
  );
}
