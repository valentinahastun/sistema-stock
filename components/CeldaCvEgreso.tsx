"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarCvEgreso } from "@/app/movimientos/actions";

// CV de una salida: a qué operación fue (baja lo comprometido de ese CV).
export default function CeldaCvEgreso({
  movimientoId,
  cv,
  puedeEditar,
}: {
  movimientoId: string;
  cv: string | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(cv ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await cambiarCvEgreso(movimientoId, valor);
    setGuardando(false);
    if (r.ok) {
      setEditando(false);
      router.refresh();
    } else setError(r.error);
  }

  if (!editando) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        {cv ? (
          <span className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-xs">{cv}</span>
        ) : (
          <span className="text-gray-400 text-xs">sin CV</span>
        )}
        {puedeEditar && (
          <button type="button" onClick={() => setEditando(true)} className="text-brand-green hover:underline text-[11px]">
            {cv ? "Cambiar" : "Poner CV"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-24 border border-gray-300 rounded px-1 py-0.5 text-xs"
        placeholder="Ej.: 26-124"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="text-white bg-brand-green hover:bg-brand-green-dark rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={() => setEditando(false)} className="text-gray-500 hover:underline text-[11px]">
          Cancelar
        </button>
      </div>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
