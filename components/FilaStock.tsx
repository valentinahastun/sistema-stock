"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmarCaidaEstimada } from "@/app/stock/actions";

export type LoteDetalle = {
  lote_id: string;
  productor: string;
  numero_cp: string | null;
  estado: string;
  fecha_ingreso: string;
  stock_actual_tn: number;
  caida_pct_estimada: number | null;
};

export type FilaBase = {
  planta_id: string;
  planta: string;
  producto_id: string;
  producto: string;
  stockDisponibleTn: number;
  comprometidoTn: number;
  libreTn: number;
};

type Modo = "planta" | "producto";

// Vista agrupada del stock: por defecto agrupa por planta (cada planta
// es un grupo colapsado que muestra su subtotal, y al abrirlo aparecen
// sus productos), pero se puede cambiar a agrupar por producto para
// contestar la pregunta inversa ("cuánto tengo de este producto en
// total, sumando todas las plantas"). Cada fila de producto, a su vez,
// se puede abrir para ver el detalle por lote de siempre.
export default function StockAgrupado({
  filas,
  lotesPorClave,
  puedeEditar,
}: {
  filas: FilaBase[];
  lotesPorClave: Map<string, LoteDetalle[]>;
  puedeEditar: boolean;
}) {
  const [modo, setModo] = useState<Modo>("planta");

  const grupos = new Map<string, { id: string; nombre: string; filas: FilaBase[] }>();
  filas.forEach((f) => {
    const id = modo === "planta" ? f.planta_id : f.producto_id;
    const nombre = modo === "planta" ? f.planta : f.producto;
    if (!grupos.has(id)) grupos.set(id, { id, nombre, filas: [] });
    grupos.get(id)!.filas.push(f);
  });

  const listaGrupos = Array.from(grupos.values())
    .map((g) => ({
      ...g,
      filas: [...g.filas].sort((a, b) =>
        (modo === "planta" ? a.producto : a.planta).localeCompare(
          modo === "planta" ? b.producto : b.planta
        )
      ),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2 text-sm">
        <span className="text-gray-500">Agrupar por:</span>
        <button
          type="button"
          onClick={() => setModo("planta")}
          className={`px-2.5 py-1 rounded ${
            modo === "planta" ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Planta
        </button>
        <button
          type="button"
          onClick={() => setModo("producto")}
          className={`px-2.5 py-1 rounded ${
            modo === "producto" ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Producto
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">{modo === "planta" ? "Planta" : "Producto"}</th>
              <th className="px-4 py-2 text-right">Disponible (tn)</th>
              <th className="px-4 py-2 text-right">Comprometido (tn)</th>
              <th className="px-4 py-2 text-right">Libre (tn)</th>
            </tr>
          </thead>
          <tbody>
            {listaGrupos.map((g) => (
              <GrupoFila
                key={g.id}
                grupo={g}
                modo={modo}
                lotesPorClave={lotesPorClave}
                puedeEditar={puedeEditar}
              />
            ))}
            {listaGrupos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No hay stock cargado todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrupoFila({
  grupo,
  modo,
  lotesPorClave,
  puedeEditar,
}: {
  grupo: { id: string; nombre: string; filas: FilaBase[] };
  modo: Modo;
  lotesPorClave: Map<string, LoteDetalle[]>;
  puedeEditar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  const disponible = grupo.filas.reduce((acc, f) => acc + f.stockDisponibleTn, 0);
  const comprometido = grupo.filas.reduce((acc, f) => acc + f.comprometidoTn, 0);
  const libre = grupo.filas.reduce((acc, f) => acc + f.libreTn, 0);

  return (
    <>
      <tr className="border-b last:border-0 bg-gray-50">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex items-center gap-1.5 font-medium text-brand-navy hover:underline"
          >
            <span className="inline-block w-3 text-xs text-gray-400">
              {abierto ? "▾" : "▸"}
            </span>
            {grupo.nombre}
            <span className="text-xs text-gray-400 font-normal">
              ({grupo.filas.length} {modo === "planta" ? "producto" : "planta"}
              {grupo.filas.length === 1 ? "" : "s"})
            </span>
          </button>
        </td>
        <td className="px-4 py-2 text-right font-medium">{disponible.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{comprometido.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{libre.toFixed(2)}</td>
      </tr>
      {abierto &&
        grupo.filas.map((f) => (
          <FilaProducto
            key={`${f.planta_id}-${f.producto_id}`}
            etiqueta={modo === "planta" ? f.producto : f.planta}
            fila={f}
            lotes={lotesPorClave.get(`${f.planta_id}-${f.producto_id}`) ?? []}
            puedeEditar={puedeEditar}
          />
        ))}
    </>
  );
}

function FilaProducto({
  etiqueta,
  fila,
  lotes,
  puedeEditar,
}: {
  etiqueta: string;
  fila: FilaBase;
  lotes: LoteDetalle[];
  puedeEditar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-4 py-2 pl-8">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex items-center gap-1.5 text-brand-navy hover:underline"
          >
            <span className="inline-block w-3 text-xs text-gray-400">
              {abierto ? "▾" : "▸"}
            </span>
            {etiqueta}
          </button>
        </td>
        <td className="px-4 py-2 text-right">{fila.stockDisponibleTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right">{fila.comprometidoTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{fila.libreTn.toFixed(2)}</td>
      </tr>
      {abierto && (
        <tr className="border-b last:border-0 bg-gray-50">
          <td colSpan={4} className="px-4 py-3">
            <DetalleLotes lotes={lotes} puedeEditar={puedeEditar} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleLotes({
  lotes,
  puedeEditar,
}: {
  lotes: LoteDetalle[];
  puedeEditar: boolean;
}) {
  if (lotes.length === 0) {
    return <p className="text-xs text-gray-400">Sin lotes cargados.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="px-2 py-1">Fecha</th>
          <th className="px-2 py-1">Productor</th>
          <th className="px-2 py-1">CP</th>
          <th className="px-2 py-1">Estado</th>
          <th className="px-2 py-1 text-right">Stock actual (tn)</th>
          <th className="px-2 py-1 text-right">% caída estim.</th>
          <th className="px-2 py-1 text-right">Descarte estim. (tn)</th>
          <th className="px-2 py-1 text-right">Exportable estim. (tn)</th>
          <th className="px-2 py-1"></th>
        </tr>
      </thead>
      <tbody>
        {lotes.map((l) => (
          <FilaLote key={l.lote_id} lote={l} puedeEditar={puedeEditar} />
        ))}
      </tbody>
    </table>
  );
}

function FilaLote({
  lote,
  puedeEditar,
}: {
  lote: LoteDetalle;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [pct, setPct] = useState(
    lote.caida_pct_estimada !== null ? String(lote.caida_pct_estimada) : ""
  );
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pctNum = pct === "" ? null : Number(pct);
  const valido = pctNum !== null && !Number.isNaN(pctNum) && pctNum > 0 && pctNum <= 100;
  const descarteEstimado = valido ? (lote.stock_actual_tn * (pctNum as number)) / 100 : null;
  const exportableEstimado =
    valido && descarteEstimado !== null ? lote.stock_actual_tn - descarteEstimado : null;

  async function confirmar() {
    if (!valido) {
      setError("Tiene que ser un número mayor a 0 y hasta 100.");
      return;
    }
    const confirmado = window.confirm(
      `Se va a cargar un descarte real de ${descarteEstimado?.toFixed(
        2
      )} tn en este lote (queda "procesado") y un ingreso nuevo por la misma cantidad como descarte. ¿Confirmás?`
    );
    if (!confirmado) return;

    setConfirmando(true);
    setError(null);
    const resultado = await confirmarCaidaEstimada(lote.lote_id, pct);
    setConfirmando(false);
    if (resultado.ok) {
      router.refresh();
    } else {
      setError(resultado.error);
    }
  }

  const esNatural = lote.estado === "natural";

  return (
    <tr className="border-t border-gray-200 align-top">
      <td className="px-2 py-1.5 whitespace-nowrap">{lote.fecha_ingreso}</td>
      <td className="px-2 py-1.5">{lote.productor}</td>
      <td className="px-2 py-1.5">{lote.numero_cp ?? "—"}</td>
      <td className="px-2 py-1.5 capitalize">{lote.estado}</td>
      <td className="px-2 py-1.5 text-right">{lote.stock_actual_tn.toFixed(2)}</td>
      <td className="px-2 py-1.5 text-right">
        {esNatural && puedeEditar ? (
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs"
            placeholder="—"
          />
        ) : esNatural ? (
          lote.caida_pct_estimada !== null ? `${lote.caida_pct_estimada}%` : "—"
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {descarteEstimado !== null ? descarteEstimado.toFixed(2) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right">
        {exportableEstimado !== null ? exportableEstimado.toFixed(2) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right">
        {esNatural && puedeEditar && (
          <div className="flex flex-col items-end gap-0.5">
            <button
              type="button"
              onClick={confirmar}
              disabled={confirmando || !valido}
              className="text-white bg-brand-green hover:bg-brand-green-dark rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
            >
              {confirmando ? "Cargando…" : "Confirmar"}
            </button>
            {error && (
              <span className="text-[10px] text-red-600 max-w-[110px]">{error}</span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
