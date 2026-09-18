"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: string; nombre: string };
type Resultado = { ok: true } | { ok: false; error: string };

// Mini formulario reutilizable para dar de alta un ítem de catálogo
// (planta, producto o productor) y ver los que ya existen, sin tener
// que tocar la base de datos a mano.
export default function AltaCatalogo({
  titulo,
  placeholder,
  items,
  accion,
}: {
  titulo: string;
  placeholder: string;
  items: Item[];
  accion: (formData: FormData) => Promise<Resultado>;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<
    { tipo: "ok" | "error"; texto: string } | null
  >(null);

  async function agregar() {
    if (!nombre.trim()) return;
    setEnviando(true);
    setMensaje(null);
    const formData = new FormData();
    formData.set("nombre", nombre);
    const resultado = await accion(formData);
    setEnviando(false);
    if (resultado.ok) {
      setNombre("");
      setMensaje({ tipo: "ok", texto: "Agregado." });
      router.refresh();
    } else {
      setMensaje({ tipo: "error", texto: resultado.error });
    }
  }

  const ordenados = [...items].sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="font-medium text-brand-navy mb-3">{titulo}</h2>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregar();
            }
          }}
          placeholder={placeholder}
          className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={agregar}
          disabled={enviando || !nombre.trim()}
          className="bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {enviando ? "…" : "Agregar"}
        </button>
      </div>

      {mensaje && (
        <p
          className={`text-xs mb-3 ${
            mensaje.tipo === "ok" ? "text-green-700" : "text-red-600"
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      <p className="text-xs text-gray-400 mb-1">
        {ordenados.length} cargado{ordenados.length === 1 ? "" : "s"}
      </p>
      <ul className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
        {ordenados.map((it) => (
          <li
            key={it.id}
            className="text-xs bg-gray-100 text-gray-700 rounded px-2 py-1"
          >
            {it.nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}
