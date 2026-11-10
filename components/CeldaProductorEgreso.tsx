"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarProductorEgreso } from "@/app/movimientos/actions";

// Productor de una salida: se puede poner o corregir después de cargarla.
// Si el nombre no está en la lista, se agrega como productor nuevo.
export default function CeldaProductorEgreso({
  movimientoId,
  productor,
  productores,
  puedeEditar,
}: {
  movimientoId: string;
  productor: string | null;
  productores: string[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const lista = useId();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(productor ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nuevo =
    valor.trim() !== "" && !productores.some((p) => p.trim().toLowerCase() === valor.trim().toLowerCase());

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await cambiarProductorEgreso(movimientoId, valor);
    setGuardando(false);
    if (r.ok) {
      setEditando(false);
      router.refresh();
    } else setError(r.error);
  }

  if (!editando) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span>{productor ?? "—"}</span>
        {puedeEditar && (
          <button type="button" onClick={() => setEditando(true)} className="text-brand-green hover:underline text-[11px]">
            {productor ? "Cambiar" : "Poner productor"}
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
        list={lista}
        className="w-36 border border-gray-300 rounded px-1 py-0.5 text-xs"
        placeholder="Escribí o elegí"
        autoFocus
      />
      <datalist id={lista}>
        {productores.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {nuevo && <span className="text-[10px] text-gray-500">Se agrega como productor nuevo</span>}
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
