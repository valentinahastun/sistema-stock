"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eliminarMovimiento } from "@/app/movimientos/actions";

export default function BotonEliminarMovimiento({
  movimientoId,
}: {
  movimientoId: string;
}) {
  const router = useRouter();
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manejarClick() {
    const confirmado = window.confirm(
      "¿Seguro que querés eliminar este movimiento? No se puede deshacer."
    );
    if (!confirmado) return;

    setEliminando(true);
    setError(null);
    const resultado = await eliminarMovimiento(movimientoId);
    setEliminando(false);

    if (resultado.ok) {
      router.refresh();
    } else {
      setError(resultado.error);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={manejarClick}
        disabled={eliminando}
        className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
      >
        {eliminando ? "Borrando…" : "Eliminar"}
      </button>
      {error && (
        <p className="text-red-600 text-xs mt-1 max-w-[180px] ml-auto">{error}</p>
      )}
    </div>
  );
}
