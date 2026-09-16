"use client";

import { useState } from "react";
import { vincularCalidad } from "@/app/calidad/actions";

export default function VincularCalidad({
  registroId,
  etiqueta,
  lotes,
}: {
  registroId: string;
  etiqueta: string;
  lotes: { id: string; etiqueta: string }[];
}) {
  const [loteId, setLoteId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  if (hecho) return null;

  async function vincular() {
    if (!loteId) return;
    setEnviando(true);
    setError(null);
    const resultado = await vincularCalidad(registroId, loteId);
    setEnviando(false);
    if (resultado.ok) {
      setHecho(true);
    } else {
      setError(resultado.error);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm border-b pb-3 last:border-0 last:pb-0">
      <span className="flex-1 min-w-[200px]">{etiqueta}</span>
      <select
        className="border rounded px-2 py-1 text-sm"
        value={loteId}
        onChange={(e) => setLoteId(e.target.value)}
      >
        <option value="">Elegir lote…</option>
        {lotes.map((l) => (
          <option key={l.id} value={l.id}>
            {l.etiqueta}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!loteId || enviando}
        onClick={vincular}
        className="bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1 text-sm disabled:opacity-50"
      >
        {enviando ? "Vinculando…" : "Vincular"}
      </button>
      {error && <span className="text-red-600 text-xs w-full">{error}</span>}
    </div>
  );
}
