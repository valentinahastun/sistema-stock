"use client";

import { useState } from "react";
import { cambiarResponsable } from "@/app/acciones";

export default function SelectorResponsable({ clave, actual }: { clave: string; actual: string | null }) {
  const [valor, setValor] = useState(actual ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={valor}
        onChange={async (e) => {
          const v = e.target.value;
          setValor(v);
          setError(null);
          const r = await cambiarResponsable(clave, v);
          if (!r.ok) setError(r.error);
        }}
        className="border rounded px-2 py-1 text-sm bg-white"
      >
        {!valor && <option value="">Sin asignar</option>}
        <option value="lourdes">Lourdes</option>
        <option value="valentina">Valentina</option>
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
