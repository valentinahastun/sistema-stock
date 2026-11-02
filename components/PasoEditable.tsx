"use client";

import { useState } from "react";
import { marcarPaso, quitarPaso } from "@/app/acciones";

// Botones para marcar, corregir o quitar un paso (solo editoras).
export default function PasoEditable({
  clave,
  paso,
  hecho,
  fechaActual,
  detalleActual,
  compacto = false,
}: {
  clave: string;
  paso: string;
  hecho: boolean;
  fechaActual: string | null;
  detalleActual: string | null;
  compacto?: boolean;
}) {
  const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(fd: FormData) {
    setGuardando(true);
    setError(null);
    const r = await marcarPaso(clave, paso, fd);
    setGuardando(false);
    if (r.ok) setAbierto(false);
    else setError(r.error);
  }

  async function quitar() {
    if (!window.confirm("¿Quitar este paso? Vuelve a quedar pendiente.")) return;
    setGuardando(true);
    const r = await quitarPaso(clave, paso);
    setGuardando(false);
    if (!r.ok) setError(r.error);
    else setAbierto(false);
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          "text-xs rounded border px-2 py-0.5 whitespace-nowrap " +
          (hecho ? "border-gray-200 text-gray-500 hover:bg-gray-50" : "border-brand-green text-brand-green-dark hover:bg-brand-green-light")
        }
      >
        {hecho ? "Editar" : compacto ? "Hecho" : "Marcar hecho"}
      </button>
    );
  }

  return (
    <form action={guardar} className="flex flex-wrap items-center gap-2 mt-1">
      <input type="date" name="fecha" defaultValue={fechaActual ?? hoy} max={hoy} required className="border rounded px-2 py-1 text-sm" />
      <input
        name="detalle"
        defaultValue={detalleActual ?? ""}
        placeholder="Nota (opcional)"
        className="border rounded px-2 py-1 text-sm w-48"
      />
      <button type="submit" disabled={guardando} className="text-xs bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5 disabled:opacity-50">
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {hecho && (
        <button type="button" onClick={quitar} disabled={guardando} className="text-xs text-red-700 hover:underline">
          Quitar
        </button>
      )}
      <button type="button" onClick={() => setAbierto(false)} className="text-xs text-gray-500 hover:underline">
        Cancelar
      </button>
      {error && <span className="text-xs text-red-600 w-full">{error}</span>}
    </form>
  );
}
