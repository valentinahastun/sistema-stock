"use client";

import { useState } from "react";
import { actualizarCaidaEstimada } from "@/app/stock/actions";

export type LoteDetalle = {
  lote_id: string;
  productor: string;
  numero_cp: string | null;
  estado: string;
  fecha_ingreso: string;
  stock_actual_tn: number;
  caida_pct_estimada: number | null;
};

export default function FilaStock({
  planta,
  producto,
  stockDisponibleTn,
  comprometidoTn,
  libreTn,
  lotes,
  puedeEditar,
}: {
  planta: string;
  producto: string;
  stockDisponibleTn: number;
  comprometidoTn: number;
  libreTn: number;
  lotes: LoteDetalle[];
  puedeEditar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex items-center gap-1.5 text-brand-navy hover:underline"
          >
            <span className="inline-block w-3 text-xs text-gray-400">
              {abierto ? "▾" : "▸"}
            </span>
            {planta}
          </button>
        </td>
        <td className="px-4 py-2">{producto}</td>
        <td className="px-4 py-2 text-right">{stockDisponibleTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right">{comprometidoTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{libreTn.toFixed(2)}</td>
      </tr>
      {abierto && (
        <tr className="border-b last:border-0 bg-gray-50">
          <td colSpan={5} className="px-4 py-3">
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
  const [pct, setPct] = useState(
    lote.caida_pct_estimada !== null ? String(lote.caida_pct_estimada) : ""
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pctNum = pct === "" ? null : Number(pct);
  const valido = pctNum === null || (!Number.isNaN(pctNum) && pctNum >= 0 && pctNum <= 100);
  const descarteEstimado =
    valido && pctNum !== null ? (lote.stock_actual_tn * pctNum) / 100 : null;
  const exportableEstimado =
    valido && pctNum !== null && descarteEstimado !== null
      ? lote.stock_actual_tn - descarteEstimado
      : null;

  async function guardar() {
    if (!valido) {
      setError("Tiene que ser un número entre 0 y 100.");
      return;
    }
    setGuardando(true);
    setError(null);
    const resultado = await actualizarCaidaEstimada(lote.lote_id, pct);
    setGuardando(false);
    if (!resultado.ok) setError(resultado.error);
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
          <div className="flex flex-col items-end gap-0.5">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              onBlur={guardar}
              className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs"
              placeholder="—"
            />
            {guardando && (
              <span className="text-[10px] text-gray-400">Guardando…</span>
            )}
            {error && <span className="text-[10px] text-red-600">{error}</span>}
          </div>
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
    </tr>
  );
}
