"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarOperacion } from "@/app/operaciones/acciones";

type Props = {
  clave: string;
  cancelada: boolean;
  pideAnticipo: boolean | null;
  pideIp: boolean | null;
  anticipoAuto: boolean;
  ipAuto: boolean;
};

// "Lleva anticipo", "Lleva IP" y cancelar la operación.
export default function OpcionesOperacion(p: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pendiente, start] = useTransition();
  const router = useRouter();

  const guardar = (campo: "cancelada" | "pide_anticipo" | "pide_ip", valor: boolean | null) =>
    start(async () => {
      setError(null);
      const r = await cambiarOperacion(p.clave, campo, valor);
      if (!r.ok) setError(r.error);
      else if (campo === "cancelada" && valor) router.push("/operaciones/lista");
      else router.refresh();
    });

  const valor = (v: boolean | null) => (v === null ? "auto" : v ? "si" : "no");
  const leer = (s: string) => (s === "auto" ? null : s === "si");

  const Selector = ({ titulo, actual, auto, campo }: {
    titulo: string; actual: boolean | null; auto: boolean; campo: "pide_anticipo" | "pide_ip";
  }) => (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      {titulo}
      <select
        defaultValue={valor(actual)}
        disabled={pendiente}
        onChange={(e) => guardar(campo, leer(e.target.value))}
        className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white"
      >
        <option value="auto">{auto ? "Sí (automático)" : "No (automático)"}</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
      </select>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-4 border-t">
      <Selector titulo="Lleva anticipo" actual={p.pideAnticipo} auto={p.anticipoAuto} campo="pide_anticipo" />
      <Selector titulo="Lleva IP" actual={p.pideIp} auto={p.ipAuto} campo="pide_ip" />
      <div className="ml-auto">
        {p.cancelada ? (
          <button
            disabled={pendiente}
            onClick={() => guardar("cancelada", false)}
            className="text-sm rounded-lg px-3 py-1.5 ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Volver a activar
          </button>
        ) : (
          <button
            disabled={pendiente}
            onClick={() => {
              if (window.confirm("¿Cancelar esta operación? Deja de aparecer en la lista, en Inicio y en el mail.")) {
                guardar("cancelada", true);
              }
            }}
            className="text-sm rounded-lg px-3 py-1.5 ring-1 ring-rose-200 text-rose-600 hover:bg-rose-50"
          >
            Cancelar operación
          </button>
        )}
      </div>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
