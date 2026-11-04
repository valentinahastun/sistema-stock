import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import PasoEditable from "@/components/PasoEditable";
import SelectorResponsable from "@/components/SelectorResponsable";
import Etapas from "@/components/Etapas";
import OpcionesOperacion from "@/components/OpcionesOperacion";
import {
  type Alerta,
  type Hito,
  type Operacion,
  anticipoAuto,
  ipAuto,
  listaDe,
  enPalabras,
  etapas,
  estaHecho,
  fecha,
  nombreOperacion,
  pasoActual,
  pasos,
  NOMBRE_FUENTE,
  NOMBRE_RESPONSABLE,
} from "@/lib/pasos";

export const dynamic = "force-dynamic";

type Estado = "hecho" | "vencida" | "proxima" | "actual" | "sin_registro" | "pendiente";

export default async function DetalleOperacion({ params }: { params: { clave: string } }) {
  const u = await getUsuario();
  if (!u) return null;
  if (!u.acceso) return <SinAcceso email={u.email} />;
  const puedeEditar = u.acceso.rol === "editor";

  const clave = decodeURIComponent(params.clave);
  const supabase = createClient();
  const [{ data: op }, { data: hitosData }, { data: alertasData }] = await Promise.all([
    supabase.from("op_operaciones").select("*").eq("clave", clave).maybeSingle(),
    supabase.from("op_hitos").select("*").eq("clave", clave),
    supabase.rpc("op_alertas"),
  ]);
  if (!op) notFound();
  const o = op as Operacion;

  const hechos = new Map<string, Hito>();
  ((hitosData ?? []) as Hito[]).forEach((h) => hechos.set(h.paso, h));
  const alertas = ((alertasData ?? []) as Alerta[]).filter((a) => a.clave === clave);
  // La alerta de GMO se muestra en "Originales completos"
  const alertaDe = new Map(alertas.map((a) => [a.paso === "gmo" ? "originales" : a.paso, a]));

  const lista = pasos(o);
  let ultimoHecho = -1;
  lista.forEach((p, i) => {
    if (estaHecho(o, p.codigo, hechos)) ultimoHecho = i;
  });
  const actual = pasoActual(o, hechos);

  const estado = (codigo: string, i: number): Estado => {
    if (estaHecho(o, codigo, hechos)) return "hecho";
    const a = alertaDe.get(codigo);
    if (a) return a.nivel;
    if (i < ultimoHecho) return "sin_registro";
    if (actual?.codigo === codigo) return "actual";
    return "pendiente";
  };

  const vencidas = alertas.filter((a) => a.nivel === "vencida").length;

  return (
    <div className="space-y-4">
      <Link href="/operaciones" className="text-sm text-gray-500 hover:text-brand-navy">← Operaciones</Link>

      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-brand-navy">{nombreOperacion(o)}</h1>
            <p className="text-sm text-gray-600">
              {o.cliente ?? "—"}
              {o.silver ? " · vía Silver Solution" : o.broker && !/directa/i.test(o.broker) ? ` · ${o.broker}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {o.carpeta_url && (
              <a href={o.carpeta_url} target="_blank" rel="noreferrer"
                 className="text-sm rounded-lg px-3 py-1.5 ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50">
                📁 Abrir carpeta
              </a>
            )}
            {o.cancelada ? (
              <span className="text-xs rounded px-2 py-1 bg-rose-50 text-rose-700">Cancelada</span>
            ) : (
              !o.activa && <span className="text-xs rounded px-2 py-1 bg-gray-100 text-gray-600">Cerrada</span>
            )}
            {vencidas > 0 && (
              <span className="text-xs rounded px-2 py-1 bg-red-100 text-red-800">
                {vencidas} {vencidas === 1 ? "alerta" : "alertas"}
              </span>
            )}
            {puedeEditar ? (
              <SelectorResponsable clave={o.clave} actual={o.responsable} />
            ) : (
              <span className="text-sm">{o.responsable ? NOMBRE_RESPONSABLE[o.responsable] : "Sin asignar"}</span>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mt-4 pt-4 border-t text-sm">
          <Dato t="Destino" v={o.destino} />
          <Dato t="Producto" v={[o.producto, o.tn ? `${Number(o.tn)} tn` : null].filter(Boolean).join(" · ")} />
          <Dato t="Condición de pago" v={o.payment_terms} />
          <Dato t="Tipo de BL" v={o.tipo_bl} />
          <Dato t="Booking" v={o.booking} />
          <Dato t="Dónde se carga" v={o.lugar_carga} />
          <Dato t="Carga en planta" v={fecha(o.fecha_carga_planta, true)} />
          <Dato t="Depósito" v={o.deposito} />
          <Dato t="Consolidado previsto" v={fecha(o.fecha_consolidado, true)} />
          <Dato t="Corte documental" v={fecha(o.corte_documental, true)} />
          <Dato t="ETD" v={fecha(o.etd, true)} />
          <Dato t="ETA" v={fecha(o.eta, true)} />
          <Dato t="Contenedores" v={o.contenedores} wide />
        </dl>
        {puedeEditar && (
          <OpcionesOperacion
            clave={o.clave}
            cancelada={!!o.cancelada}
            pideAnticipo={o.pide_anticipo ?? null}
            pideIp={o.pide_ip ?? null}
            anticipoAuto={anticipoAuto(o)}
            ipAuto={ipAuto(o)}
          />
        )}
      </div>

      <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-5 space-y-5">
        <Etapas etapas={etapas(o, hechos)} alerta={vencidas > 0} />
        <div className={"rounded-lg px-4 py-2.5 text-sm flex gap-2 " + (vencidas ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-800")}>
          <span aria-hidden="true">{vencidas ? "⚠️" : "👉"}</span>
          <span>{vencidas ? alertas.filter((a) => a.nivel === "vencida")[0].mensaje : "Ahora: " + enPalabras(o, hechos)}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-medium text-brand-navy mb-3">Paso a paso</h2>
        <ol>
          {lista.map((p, i) => {
            const e = estado(p.codigo, i);
            const h = hechos.get(p.codigo);
            const a = alertaDe.get(p.codigo);
            const ultimo = i === lista.length - 1;
            return (
              <li key={p.codigo} className="grid grid-cols-[28px_1fr_auto] gap-3">
                <div className="flex flex-col items-center">
                  <Icono estado={e} />
                  {!ultimo && (
                    <div className={"flex-1 w-0 min-h-[14px] " + (e === "hecho" ? "border-l-2 border-brand-green" : "border-l-2 border-dotted border-gray-300")} />
                  )}
                </div>
                <div className="pb-4 pt-0.5">
                  <div className={"text-sm " + (e === "pendiente" || e === "sin_registro" ? "text-gray-500" : "font-medium")}>
                    {p.nombre}
                  </div>
                  {a && (
                    <div className={"text-xs " + (a.nivel === "vencida" ? "text-red-700" : "text-amber-700")}>{a.mensaje}</div>
                  )}
                  {e === "sin_registro" && !listaDe(o, p.codigo, hechos) && (
                    <div className="text-xs text-gray-400">No quedó registrado (la operación ya avanzó)</div>
                  )}
                  {!a && e !== "hecho" && p.ayuda && e !== "sin_registro" && <div className="text-xs text-gray-400">{p.ayuda}</div>}
                  {h && (h.detalle || h.fuente) && (
                    <div className="text-xs text-gray-500">
                      {h.detalle ? h.detalle + " · " : ""}
                      {h.fecha ? "" : "fecha sin dato · "}
                      fuente: {NOMBRE_FUENTE[h.fuente] ?? h.fuente}
                      {h.fuente === "manual" && h.updated_by ? ` (${h.updated_by.split("@")[0]})` : ""}
                      {h.mail_url && (
                        <>
                          {" · "}
                          <a href={h.mail_url} target="_blank" rel="noreferrer" className="underline">
                            {h.fuente === "drive" ? "ver archivo" : "ver mail"}
                          </a>
                        </>
                      )}
                    </div>
                  )}

                  {listaDe(o, p.codigo, hechos) && (() => {
                    const docs = listaDe(o, p.codigo, hechos)!;
                    const listos = docs.filter((d) => hechos.has(d.codigo)).length;
                    return (
                      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-500 mb-1.5">
                          {h ? "Marcado como completo" : `${listos} de ${docs.length} listos`}
                        </div>
                        <ul className="space-y-1">
                          {docs.map((d) => {
                            const hd = hechos.get(d.codigo);
                            const ok = !!hd || !!h;
                            return (
                              <li key={d.codigo} className="flex flex-wrap items-center gap-2 text-sm">
                                <span className={ok ? "text-emerald-600" : "text-slate-300"}>{ok ? "✓" : "○"}</span>
                                {hd?.mail_url ? (
                                  <a href={hd.mail_url} target="_blank" rel="noreferrer" className="hover:underline" title={hd.detalle ?? ""}>
                                    {d.nombre}
                                  </a>
                                ) : (
                                  <span className={ok ? "text-slate-700" : "text-slate-400"}>{d.nombre}</span>
                                )}
                                {hd?.fecha && <span className="text-xs text-slate-400">{fecha(hd.fecha)}</span>}
                                {!ok && <span className="text-xs text-slate-400">falta</span>}
                                {puedeEditar && !h && (
                                  <PasoEditable clave={o.clave} paso={d.codigo} hecho={!!hd} fechaActual={hd?.fecha ?? null} detalleActual={hd?.detalle ?? null} compacto />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}

                  {puedeEditar && (
                    <div className="mt-1">
                      <PasoEditable clave={o.clave} paso={p.codigo} hecho={!!h} fechaActual={h?.fecha ?? null} detalleActual={h?.detalle ?? null} />
                    </div>
                  )}
                </div>
                <div className="text-sm text-gray-500 pt-0.5 whitespace-nowrap">
                  {h ? (h.fecha ? fecha(h.fecha) : "✓") : a?.fecha_limite ? `vence ${fecha(a.fecha_limite)}` : ""}
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-3 border-t">
          <span className="flex items-center gap-1"><Icono estado="hecho" chico /> Hecho</span>
          <span className="flex items-center gap-1"><Icono estado="vencida" chico /> Alerta</span>
          <span className="flex items-center gap-1"><Icono estado="proxima" chico /> Vence pronto</span>
          <span className="flex items-center gap-1"><Icono estado="actual" chico /> Paso actual</span>
          <span className="flex items-center gap-1"><Icono estado="pendiente" chico /> Pendiente</span>
        </div>
      </div>
    </div>
  );
}

function Dato({ t, v, wide }: { t: string; v: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-xs text-gray-500">{t}</dt>
      <dd className="break-words">{v && v !== "—" ? v : <span className="text-gray-300">—</span>}</dd>
    </div>
  );
}

function Icono({ estado, chico }: { estado: Estado; chico?: boolean }) {
  const s = chico ? "w-3 h-3" : "w-4 h-4 mt-0.5";
  const clases: Record<Estado, string> = {
    hecho: "bg-brand-green border-brand-green",
    vencida: "bg-red-500 border-red-500",
    proxima: "bg-amber-400 border-amber-400",
    actual: "bg-white border-brand-navy border-[3px]",
    sin_registro: "bg-white border-gray-300 border-dashed",
    pendiente: "bg-white border-gray-300",
  };
  return <span className={`${s} rounded-full border-2 shrink-0 ${clases[estado]}`} aria-hidden="true" />;
}
