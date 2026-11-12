"use client";

import { useState, useTransition } from "react";
import { marcarNoAplica, marcarReclamo } from "@/app/arribos/actions";

export function BotonNoAplica({ id, deshacer = false }: { id: string; deshacer?: boolean }) {
  const [pend, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pend}
      onClick={() => start(async () => void (await marcarNoAplica(id, !deshacer)))}
      className="text-xs text-gray-500 underline hover:text-brand-navy disabled:opacity-50"
      title={deshacer ? "Volver a esperar su arribo" : "No va a un depósito: no esperar su arribo"}
    >
      {deshacer ? "Esperar arribo" : "No va a depósito"}
    </button>
  );
}

export function Reclamo({
  id,
  estado,
  a,
  nota,
}: {
  id: string;
  estado: string | null;
  a: string | null;
  nota: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [dest, setDest] = useState<"transportista" | "carga" | "">((a as any) ?? "");
  const [texto, setTexto] = useState(nota ?? "");
  const [pend, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const guardar = (nuevo: "reclamado" | "resuelto" | null) =>
    start(async () => {
      const r = await marcarReclamo(id, nuevo, dest || null, texto);
      if (!r.ok) setError(r.error);
      else setAbierto(false);
    });

  const etiqueta =
    estado === "resuelto"
      ? "✓ Resuelto"
      : estado === "reclamado"
      ? `Reclamado${a ? (a === "transportista" ? " al transportista" : " a la carga") : ""}`
      : "Sin reclamar";

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        className={`rounded-full px-2 py-0.5 font-medium ${
          estado === "resuelto"
            ? "bg-emerald-50 text-emerald-700"
            : estado === "reclamado"
            ? "bg-amber-50 text-amber-700"
            : "bg-rose-50 text-rose-700"
        }`}
      >
        {etiqueta} ▾
      </button>
      {nota && !abierto && <div className="text-gray-500 mt-0.5">{nota}</div>}
      {abierto && (
        <div className="mt-2 space-y-2 rounded border p-2 bg-gray-50">
          <div className="flex gap-3">
            <label className="flex items-center gap-1">
              <input type="radio" checked={dest === "transportista"} onChange={() => setDest("transportista")} /> Transportista
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={dest === "carga"} onChange={() => setDest("carga")} /> Quien estuvo en la carga
            </label>
          </div>
          <input
            className="input text-xs"
            placeholder="Nota (opcional): a quién, cuándo, cómo quedó…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pend} onClick={() => guardar("reclamado")} className="rounded bg-amber-600 text-white px-2 py-1">
              Marcar reclamado
            </button>
            <button type="button" disabled={pend} onClick={() => guardar("resuelto")} className="rounded bg-emerald-600 text-white px-2 py-1">
              Marcar resuelto
            </button>
            {estado && (
              <button type="button" disabled={pend} onClick={() => guardar(null)} className="rounded border px-2 py-1">
                Sin reclamar
              </button>
            )}
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
