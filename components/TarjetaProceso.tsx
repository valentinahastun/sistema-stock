"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cerrarProceso, deshacerCierre, eliminarProceso } from "@/app/procesos/actions";
import { tn, fechaCorta, hoyIso } from "@/lib/procesos";

export type ProcesoVista = {
  id: string;
  numero: string | null;
  planta: string;
  producto: string;
  cv: string | null;
  estado: "en_proceso" | "terminado";
  fecha_inicio: string;
  fecha_fin: string | null;
  entrada_tn: number;
  procesado_tn: number | null;
  descarte_tn: number | null;
  bolsas_25: number | null;
  bolsas_50: number | null;
  big_bags: number | null;
  historico: boolean;
  observaciones: string | null;
  productores: string[];
  lotes: number;
  viene_de: string[]; // procesos de donde viene lo que entró (reproceso)
  reprocesado_en: string[]; // procesos donde volvió a entrar lo que salió
};


const nombreProceso = (numero: string | null, fecha?: string | null) =>
  numero ? `Proceso ${numero}` : fecha ? `Proceso del ${fechaCorta(fecha)}` : "proceso sin número";

function textoBolsas(p: { bolsas_25: number | null; bolsas_50: number | null; big_bags: number | null }) {
  const partes: string[] = [];
  if (p.bolsas_25) partes.push(`${p.bolsas_25.toLocaleString("es-AR")} bolsas de 25 kg`);
  if (p.bolsas_50) partes.push(`${p.bolsas_50.toLocaleString("es-AR")} bolsas de 50 kg`);
  if (p.big_bags) partes.push(`${p.big_bags.toLocaleString("es-AR")} big bags`);
  return partes.join(" · ");
}

export default function TarjetaProceso({ p, puedeEditar }: { p: ProcesoVista; puedeEditar: boolean }) {
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminado = p.estado === "terminado";
  const rinde = terminado && p.entrada_tn > 0 && p.procesado_tn !== null ? (p.procesado_tn / p.entrada_tn) * 100 : null;
  const pctDescarte = rinde !== null ? 100 - rinde : null;

  async function accion(fn: () => Promise<{ ok: boolean; error?: string }>, pregunta: string) {
    if (!window.confirm(pregunta)) return;
    setOcupado(true);
    setError(null);
    const r = await fn();
    setOcupado(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "No se pudo.");
  }

  const periodo = terminado
    ? p.fecha_fin && p.fecha_fin !== p.fecha_inicio
      ? `${fechaCorta(p.fecha_inicio)} al ${fechaCorta(p.fecha_fin)}`
      : fechaCorta(p.fecha_fin ?? p.fecha_inicio)
    : `desde ${fechaCorta(p.fecha_inicio)}`;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-semibold text-brand-navy">
            {nombreProceso(p.numero, p.fecha_inicio)} · {p.producto}
          </div>
          <div className="text-xs text-gray-500">
            {p.planta} · {periodo} · {p.cv ?? "sin CV"}
          </div>
        </div>
        <div className="flex gap-1.5">
          {p.historico && (
            <span className="text-xs rounded px-2 py-0.5 bg-gray-100 text-gray-600">De la planilla</span>
          )}
          <span
            className={`text-xs rounded px-2 py-0.5 ${
              terminado ? "bg-brand-green-light text-brand-green-dark" : "bg-sky-50 text-sky-700"
            }`}
          >
            {terminado ? "Terminado" : "En proceso"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-stretch">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Entró</div>
          <div className="text-lg font-semibold text-gray-800">{tn(p.entrada_tn)} tn</div>
          <div className="text-[11px] text-gray-500 leading-tight">
            {p.productores.length ? p.productores.join(", ") : p.lotes ? `${p.lotes} lotes` : ""}
          </div>
        </div>
        <div className="flex items-center justify-center text-gray-300">→</div>
        {terminado ? (
          <>
            <div className="rounded-lg bg-brand-green-light px-3 py-2">
              <div className="text-xs text-brand-green-dark">Salió procesado</div>
              <div className="text-lg font-semibold text-brand-green-dark">{tn(p.procesado_tn)} tn</div>
              <div className="text-[11px] text-brand-green-dark">rinde {tn(rinde, 1)}%</div>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <div className="text-xs text-amber-700">Descarte</div>
              <div className="text-lg font-semibold text-amber-800">{tn(p.descarte_tn)} tn</div>
              <div className="text-[11px] text-amber-700">{tn(pctDescarte, 1)}%</div>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Todavía no se cargó lo que salió</span>
            {puedeEditar && !cerrando && (
              <button
                type="button"
                onClick={() => setCerrando(true)}
                className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1"
              >
                Cerrar proceso
              </button>
            )}
          </div>
        )}
      </div>

      {terminado && rinde !== null && (
        <div className="flex h-2 rounded overflow-hidden mt-3">
          <div className="bg-brand-green" style={{ width: `${rinde}%` }} />
          <div className="bg-amber-300" style={{ width: `${100 - rinde}%` }} />
        </div>
      )}

      <div className="text-xs text-gray-500 mt-2 space-y-0.5">
        {textoBolsas(p) && <div>Embolsado: {textoBolsas(p)}</div>}
        {p.viene_de.length > 0 && <div>Es un reproceso de lo que salió del {p.viene_de.map((n) => nombreProceso(n)).join(", ")}</div>}
        {p.reprocesado_en.length > 0 && (
          <div>Parte de lo que salió volvió a entrar en el {p.reprocesado_en.map((n) => nombreProceso(n)).join(", ")}</div>
        )}
        {p.observaciones && <div className="whitespace-pre-line">{p.observaciones}</div>}
      </div>

      {cerrando && (
        <FormCierre
          entradaTn={p.entrada_tn}
          onCancelar={() => setCerrando(false)}
          onGuardar={async (c) => {
            const r = await cerrarProceso(p.id, c);
            if (r.ok) {
              setCerrando(false);
              router.refresh();
            }
            return r;
          }}
        />
      )}

      {puedeEditar && (
        <div className="flex gap-4 justify-end mt-3 text-xs">
          {terminado && !p.historico && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() =>
                accion(
                  () => deshacerCierre(p.id),
                  "El proceso vuelve a quedar \"En proceso\" y se borra lo que salió (procesado y descarte) para cargarlo de nuevo. ¿Seguimos?"
                )
              }
              className="text-gray-500 hover:text-brand-navy disabled:opacity-50"
            >
              Corregir lo que salió
            </button>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={() =>
              accion(
                () => eliminarProceso(p.id),
                p.historico
                  ? "Se borra este registro de la planilla. El stock no cambia. ¿Seguimos?"
                  : "Se borra el proceso y los lotes que entraron recuperan su stock. ¿Seguimos?"
              )
            }
            className="text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            Borrar proceso
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2 text-right">{error}</p>}
    </div>
  );
}

export type ValoresCierre = {
  procesado_tn: string;
  bolsas_25: string;
  bolsas_50: string;
  big_bags: string;
  fecha_fin: string;
};


// Lo que salió del proceso: tn procesadas y bolsas. El descarte es la diferencia.
export function CamposCierre({
  entradaTn,
  v,
  set,
}: {
  entradaTn: number;
  v: ValoresCierre;
  set: (v: ValoresCierre) => void;
}) {
  const proc = Number(v.procesado_tn.replace(",", "."));
  const valido = v.procesado_tn !== "" && !Number.isNaN(proc) && proc > 0;
  const enBolsas = (Number(v.bolsas_25 || 0) * 25 + Number(v.bolsas_50 || 0) * 50) / 1000;
  const campo = "border border-gray-300 rounded px-2 py-1.5 text-sm w-full";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <label className="text-xs text-gray-600 col-span-2 sm:col-span-1">
          Salió procesado (tn)
          <input className={campo} inputMode="decimal" value={v.procesado_tn} onChange={(e) => set({ ...v, procesado_tn: e.target.value })} placeholder="142,4" />
        </label>
        <label className="text-xs text-gray-600">
          Bolsas de 25 kg
          <input className={campo} inputMode="numeric" value={v.bolsas_25} onChange={(e) => set({ ...v, bolsas_25: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="text-xs text-gray-600">
          Bolsas de 50 kg
          <input className={campo} inputMode="numeric" value={v.bolsas_50} onChange={(e) => set({ ...v, bolsas_50: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="text-xs text-gray-600">
          Big bags
          <input className={campo} inputMode="numeric" value={v.big_bags} onChange={(e) => set({ ...v, big_bags: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="text-xs text-gray-600">
          Terminó el
          <input type="date" className={campo} value={v.fecha_fin} onChange={(e) => set({ ...v, fecha_fin: e.target.value })} />
        </label>
      </div>
      <div className="text-xs text-gray-600">
        {valido ? (
          proc > entradaTn ? (
            <span className="text-red-600">Salió más de lo que entró ({tn(entradaTn)} tn).</span>
          ) : (
            <>
              Descarte: <b>{tn(entradaTn - proc, 3)} tn</b> · rinde <b>{tn((proc / entradaTn) * 100, 1)}%</b>
            </>
          )
        ) : (
          <>Entraron {tn(entradaTn)} tn. Poné cuánto salió procesado y el descarte se calcula solo.</>
        )}
        {enBolsas > 0 && <span className="text-gray-400"> · las bolsas de 25 y 50 kg suman {tn(enBolsas, 3)} tn</span>}
      </div>
    </div>
  );
}

function FormCierre({
  entradaTn,
  onCancelar,
  onGuardar,
}: {
  entradaTn: number;
  onCancelar: () => void;
  onGuardar: (c: ValoresCierre) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [v, setV] = useState<ValoresCierre>({ procesado_tn: "", bolsas_25: "", bolsas_50: "", big_bags: "", fecha_fin: hoyIso() });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const proc = Number(v.procesado_tn.replace(",", "."));
    if (!v.procesado_tn || Number.isNaN(proc) || proc <= 0) return setError("Poné cuántas tn salieron procesadas.");
    if (proc > entradaTn) return setError("Salió más de lo que entró.");
    setGuardando(true);
    setError(null);
    const r = await onGuardar({ ...v, procesado_tn: String(proc) });
    setGuardando(false);
    if (!r.ok) setError(r.error ?? "No se pudo cerrar.");
  }

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3 space-y-2">
      <CamposCierre entradaTn={entradaTn} v={v} set={(x) => { setV(x); setError(null); }} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancelar} className="text-sm text-gray-500 px-3 py-1">
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1 disabled:opacity-50"
        >
          {guardando ? "Guardando…" : "Guardar y cerrar"}
        </button>
      </div>
    </div>
  );
}
