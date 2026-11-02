"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Elegir una contraseña nueva (sirve también para el sistema de stock:
// es el mismo usuario).
export default function CambiarContrasena() {
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [cargando, setCargando] = useState(false);
  const supabase = createClient();

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave.length < 8) return setError("Tiene que tener al menos 8 caracteres.");
    if (clave !== repetir) return setError("Las dos contraseñas no coinciden.");
    setCargando(true);
    const { error } = await supabase.auth.updateUser({ password: clave });
    setCargando(false);
    if (error) return setError("No se pudo guardar: " + error.message);
    setOk(true);
    setClave("");
    setRepetir("");
  }

  return (
    <div className="max-w-sm mx-auto bg-white rounded-lg shadow p-6 mt-6">
      <h1 className="text-lg font-semibold text-brand-navy mb-1">Cambiar contraseña</h1>
      <p className="text-xs text-gray-500 mb-4">Es la misma para Operaciones Comex y el sistema de stock.</p>
      {ok ? (
        <div className="space-y-3">
          <p className="text-sm text-green-700">Contraseña guardada.</p>
          <Link href="/" className="text-sm text-brand-navy underline">Volver a la agenda</Link>
        </div>
      ) : (
        <form onSubmit={guardar} className="space-y-3">
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Contraseña nueva" className="w-full border rounded px-3 py-2" />
          <input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} placeholder="Repetila" className="w-full border rounded px-3 py-2" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={cargando} className="w-full bg-brand-green hover:bg-brand-green-dark text-white rounded py-2 font-medium disabled:opacity-50">
            {cargando ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}
    </div>
  );
}
