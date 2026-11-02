import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import FiltroResponsable from "@/components/FiltroResponsable";
import {
  type Alerta,
  type Hito,
  type Operacion,
  fecha,
  nombreOperacion,
  pasoActual,
  pasos,
  estaHecho,
  NOMBRE_RESPONSABLE,
} from "@/lib/pasos";

export const dynamic = "force-dynamic";

export default async function Operaciones({
  searchParams,
}: {
  searchParams: { resp?: string; q?: string };
}) {
  const u = await getUsuario();
  if (!u) return null;
  if (!u.acceso) return <SinAcceso email={u.email} />;

  const resp = searchParams.resp ?? "todas";
  const q = (searchParams.q ?? "").trim().toLowerCase();
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
  const alertasPorOp = new Map<string, { v: number; p: number }>();
  ((alertas ?? []) as Alerta[]).forEach((a) => {
    const x = alertasPorOp.get(a.clave) ?? { v: 0, p: 0 };
    if (a.nivel === "vencida") x.v++;
    else x.p++;
    alertasPorOp.set(a.clave, x);
  });

  let lista = (ops ?? []) as Operacion[];
  if (resp !== "todas") lista = lista.filter((o) => o.responsable === resp);
  if (q) {
    lista = lista.filter((o) =>
      [o.clave, o.cv, o.cliente, o.destino, o.producto, o.booking].some((x) => (x ?? "").toLowerCase().includes(q))
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-navy">
          Operaciones abiertas <span className="text-gray-400 font-normal text-base">({lista.length})</span>
        </h1>
        <div className="flex items-center gap-3">
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

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Operación</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2">Avance</th>
              <th className="px-4 py-2">Próximo paso</th>
              <th className="px-4 py-2">ETA</th>
              <th className="px-4 py-2">Alertas</th>
              <th className="px-4 py-2">Responsable</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((o) => {
              const h = porOp.get(o.clave) ?? new Map<string, Hito>();
              const total = pasos(o);
              const hechos = total.filter((p) => estaHecho(o, p.codigo, h)).length;
              const actual = pasoActual(o, h);
              const al = alertasPorOp.get(o.clave);
              return (
                <tr key={o.clave} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link href={`/operaciones/${encodeURIComponent(o.clave)}`} className="text-brand-navy font-medium hover:underline">
                      {nombreOperacion(o)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 max-w-[180px] truncate" title={o.cliente ?? ""}>{o.cliente ?? "—"}</td>
                  <td className="px-4 py-2 max-w-[160px] truncate" title={o.destino ?? ""}>{o.destino ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded bg-gray-200 overflow-hidden">
                        <div className="h-full bg-brand-green" style={{ width: `${(hechos / total.length) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{hechos}/{total.length}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">{actual?.nombre ?? "Terminada"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fecha(o.eta)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {al?.v ? <span className="text-xs rounded px-2 py-0.5 bg-red-100 text-red-800 mr-1">{al.v}</span> : null}
                    {al?.p ? <span className="text-xs rounded px-2 py-0.5 bg-amber-100 text-amber-800">{al.p}</span> : null}
                    {!al && <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2">{o.responsable ? NOMBRE_RESPONSABLE[o.responsable] : <span className="text-amber-700">Sin asignar</span>}</td>
                </tr>
              );
            })}
            {lista.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">No hay operaciones para este filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
