"use client";

import { useState, useTransition } from "react";
import { resolverMail } from "@/app/acciones";

type Props = {
  id: string;
  clave: string | null;
  paso: string;
  operaciones: { clave: string; texto: string }[];
  pasos: { codigo: string; nombre: string }[];
};

export default function ResolverMail({ id, clave, paso, operaciones, pasos }: Props) {
  const [op, setOp] = useState(clave ?? "");
  const [p, setP] = useState(paso);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [pendiente, start] = useTransition();

  if (hecho) return <div className="text-xs text-brand-green-dark">{hecho}</div>;

  const enviar = (accion: "confirmar" | "descartar") =>
    start(async () => {
      setError(null);
      const r = await resolverMail(id, accion, accion === "confirmar" ? op : null, accion === "confirmar" ? p : null);
      if (!r.ok) setError(r.error);
      else setHecho(accion === "confirmar" ? "Confirmado ✓" : "Descartado");
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={op} onChange={(e) => setOp(e.target.value)} className="border rounded px-2 py-1 bg-white max-w-xs">
        <option value="">Elegí la operación…</option>
        {operaciones.map((o) => (
          <option key={o.clave} value={o.clave}>{o.texto}</option>
        ))}
      </select>
      <select value={p} onChange={(e) => setP(e.target.value)} className="border rounded px-2 py-1 bg-white">
        {pasos.map((x) => (
          <option key={x.codigo} value={x.codigo}>{x.nombre}</option>
        ))}
      </select>
      <button
        disabled={pendiente || !op}
        onClick={() => enviar("confirmar")}
        className="rounded bg-brand-green text-white px-3 py-1 disabled:opacity-50"
      >
        Confirmar
      </button>
      <button
        disabled={pendiente}
        onClick={() => enviar("descartar")}
        className="rounded border px-3 py-1 text-gray-600 disabled:opacity-50"
      >
        Descartar
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
