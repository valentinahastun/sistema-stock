"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { crearProceso } from "@/app/procesos/actions";
import { CamposCierre } from "@/components/TarjetaProceso";
import { tn, fechaCorta, hoyIso, cierreVacio, errorCierre, cierreParaGuardar, type ValoresCierre } from "@/lib/procesos";

type Catalogo = { id: string; nombre: string };

export type LoteDisponible = {
  lote_id: string;
  planta_id: string;
  producto_id: string;
  productor: string;
  numero_cp: string | null;
  estado: string;
  fecha_ingreso: string;
  stock_tn: number;
  cv: string | null;
  de_proceso: boolean;
  proceso: string | null;
  tipo_descarte: string | null; // "segundilla" cuando es segundilla que vuelve a proceso
};

const num = (s: string) => Number(s.replace(",", "."));

export default function ProcesoForm({
  plantas,
  productos,
  lotes,
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  lotes: LoteDisponible[];
}) {
  const router = useRouter();
  const [planta, setPlanta] = useState("");
  const [producto, setProducto] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [cv, setCv] = useState("");
  const [obs, setObs] = useState("");
  // lote_id -> tn que entran ("" = no entra)
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [terminado, setTerminado] = useState(false);
  const [cierre, setCierre] = useState<ValoresCierre>(cierreVacio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productosDePlanta = useMemo(() => {
    const ids = new Set(lotes.filter((l) => l.planta_id === planta).map((l) => l.producto_id));
    return productos.filter((p) => ids.has(p.id));
  }, [planta, lotes, productos]);

  const candidatos = useMemo(
    () =>
      lotes
        .filter((l) => l.planta_id === planta && l.producto_id === producto)
        .sort((a, b) => (a.estado === b.estado ? (a.fecha_ingreso < b.fecha_ingreso ? -1 : 1) : a.estado === "natural" ? -1 : 1)),
    [planta, producto, lotes]
  );

  const entradas = candidatos
    .filter((l) => elegidos[l.lote_id] !== undefined)
    .map((l) => ({ lote: l, tn: num(elegidos[l.lote_id] || "0") }));
  const totalEntra = entradas.reduce((s, e) => s + (Number.isNaN(e.tn) ? 0 : e.tn), 0);
  const cvsDeLotes = Array.from(new Set(entradas.map((e) => e.lote.cv ?? "")));
  const cvSugerido = cvsDeLotes.length === 1 && cvsDeLotes[0] ? cvsDeLotes[0] : "";

  function cambiarPlanta(id: string) {
    setPlanta(id);
    setProducto("");
    setElegidos({});
  }
  function cambiarProducto(id: string) {
    setProducto(id);
    setElegidos({});
  }
  function tildar(l: LoteDisponible, si: boolean) {
    const n = { ...elegidos };
    if (si) n[l.lote_id] = String(Math.round(l.stock_tn * 1000) / 1000);
    else delete n[l.lote_id];
    setElegidos(n);
    setError(null);
  }

  async function guardar() {
    setError(null);
    if (!planta || !producto) return setError("Elegí la planta y el producto.");
    if (!entradas.length) return setError("Tildá al menos un lote que entre al proceso.");
    for (const e of entradas) {
      if (Number.isNaN(e.tn) || e.tn <= 0) return setError(`Poné cuántas tn entran del lote de ${e.lote.productor}.`);
      if (e.tn > e.lote.stock_tn + 0.0005)
        return setError(`Del lote de ${e.lote.productor} hay ${tn(e.lote.stock_tn, 3)} tn.`);
    }
    if (terminado) {
      const e = errorCierre(cierre, totalEntra);
      if (e) return setError(e);
      if (cierre.fecha_fin < fecha) return setError("La fecha de fin es anterior al inicio.");
    }
    setGuardando(true);
    const r = await crearProceso(
      {
        numero,
        planta_id: planta,
        producto_id: producto,
        cv: cv || cvSugerido,
        fecha_inicio: fecha,
        observaciones: obs,
        entradas: entradas.map((e) => ({ lote_id: e.lote.lote_id, cantidad: e.tn })),
      },
      terminado ? cierreParaGuardar(cierre) : null
    );
    setGuardando(false);
    if (r.ok) {
      router.push("/procesos");
      router.refresh();
    } else setError(r.error);
  }

  const campo = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full bg-white";
  const paso = "rounded-xl bg-white border border-gray-200 p-4 space-y-3";
  const titulo = "text-sm font-semibold text-brand-navy";

  return (
    <div className="space-y-4">
      <div className={paso}>
        <div className={titulo}>1 · Qué entra a procesar</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-xs text-gray-600">
            Planta
            <select className={campo} value={planta} onChange={(e) => cambiarPlanta(e.target.value)}>
              <option value="">Elegí…</option>
              {plantas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Producto
            <select className={campo} value={producto} onChange={(e) => cambiarProducto(e.target.value)} disabled={!planta}>
              <option value="">{planta ? "Elegí…" : "Primero la planta"}</option>
              {productosDePlanta.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            Empezó el
            <input type="date" className={campo} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
        </div>

        {planta && producto && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {candidatos.length === 0 && <p className="text-sm text-gray-400 p-3">No hay stock de ese producto en esa planta.</p>}
            {candidatos.map((l) => {
              const si = elegidos[l.lote_id] !== undefined;
              return (
                <div key={l.lote_id} className={`flex items-center gap-3 px-3 py-2 border-t first:border-t-0 border-gray-100 ${si ? "bg-brand-green-light" : ""}`}>
                  <input type="checkbox" checked={si} onChange={(e) => tildar(l, e.target.checked)} className="h-4 w-4" />
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="text-gray-800 truncate">{l.productor}</div>
                    <div className="text-xs text-gray-500">
                      {l.tipo_descarte === "segundilla" ? `Segundilla${l.de_proceso ? ` · del proceso ${l.proceso ?? "sin número"}` : ""}` : l.estado === "natural" ? "Natural" : l.de_proceso ? `Procesado · salió del proceso ${l.proceso ?? "sin número"}` : "Procesado"}
                      {" · "}ingresó {fechaCorta(l.fecha_ingreso)}
                      {l.numero_cp ? ` · CP ${l.numero_cp}` : ""}
                      {l.cv ? ` · ${l.cv}` : ""}
                      {" · hay "}{tn(l.stock_tn, 3)} tn
                    </div>
                  </div>
                  {si && (
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      entran
                      <input
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-20 text-right bg-white"
                        inputMode="decimal"
                        value={elegidos[l.lote_id]}
                        onChange={(e) => setElegidos({ ...elegidos, [l.lote_id]: e.target.value })}
                      />
                      tn
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {entradas.length > 0 && (
          <div className="text-sm text-gray-700">
            Entran <b>{tn(totalEntra, 3)} tn</b> de {entradas.length} {entradas.length === 1 ? "lote" : "lotes"}.
          </div>
        )}
      </div>

      <div className={paso}>
        <div className={titulo}>2 · Datos del proceso</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            N° de proceso (si la planta le pone uno)
            <input className={campo} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="62" />
          </label>
          <label className="text-xs text-gray-600">
            Para qué CV (opcional)
            <input className={campo} value={cv} onChange={(e) => setCv(e.target.value)} placeholder={cvSugerido || "26-130"} />
          </label>
        </div>
        {cvSugerido && !cv && <p className="text-xs text-gray-500">Si lo dejás vacío, queda para la {cvSugerido}, como los lotes que entran.</p>}
        <label className="text-xs text-gray-600 block">
          Observaciones
          <textarea className={campo} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
      </div>

      <div className={paso}>
        <div className={titulo}>3 · ¿Ya terminó?</div>
        <div className="flex flex-col sm:flex-row gap-2 text-sm">
          <label className={`flex-1 border rounded-lg px-3 py-2 cursor-pointer ${!terminado ? "border-brand-green bg-brand-green-light" : "border-gray-200"}`}>
            <input type="radio" className="mr-2" checked={!terminado} onChange={() => setTerminado(false)} />
            Todavía está en proceso
            <div className="text-xs text-gray-500 ml-5">Lo cerrás después, cuando sepas cuánto salió.</div>
          </label>
          <label className={`flex-1 border rounded-lg px-3 py-2 cursor-pointer ${terminado ? "border-brand-green bg-brand-green-light" : "border-gray-200"}`}>
            <input type="radio" className="mr-2" checked={terminado} onChange={() => setTerminado(true)} />
            Ya terminó
            <div className="text-xs text-gray-500 ml-5">Cargás ahora cuánto salió procesado.</div>
          </label>
        </div>
        {terminado && <CamposCierre entradaTn={totalEntra} v={cierre} set={setCierre} />}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => router.push("/procesos")} className="text-sm text-gray-500 px-3 py-1.5">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-4 py-1.5 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : terminado ? "Guardar terminado" : "Guardar en proceso"}
        </button>
      </div>
    </div>
  );
}
