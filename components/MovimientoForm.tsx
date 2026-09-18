"use client";

import { useState } from "react";
import { crearIngreso, crearMovimiento, crearEgreso } from "@/app/movimientos/actions";

type Catalogo = { id: string; nombre: string };
type Lote = {
  id: string;
  numero_cp: string | null;
  estado: string;
  fecha_ingreso: string;
  plantas: { nombre: string }[] | { nombre: string } | null;
  productos: { nombre: string }[] | { nombre: string } | null;
  productores: { nombre: string }[] | { nombre: string } | null;
};

// Supabase puede devolver la relación embebida como objeto o como array
// según la versión del cliente; esto normaliza ambos casos.
function nombreDe(rel: { nombre: string }[] | { nombre: string } | null): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

export default function MovimientoForm({
  plantas,
  productos,
  productores,
  lotes,
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  productores: Catalogo[];
  lotes: Lote[];
}) {
  const [tipo, setTipo] = useState<"ingreso" | "descarte" | "egreso">(
    "ingreso"
  );
  const [motivoDescarte, setMotivoDescarte] = useState("procesamiento");
  const [mensaje, setMensaje] = useState<
    { tipo: "ok" | "error"; texto: string } | null
  >(null);
  const [enviando, setEnviando] = useState(false);

  const hoy = new Date().toISOString().slice(0, 10);

  async function handleSubmit(formData: FormData) {
    setEnviando(true);
    setMensaje(null);

    const resultado =
      tipo === "ingreso"
        ? await crearIngreso(formData)
        : tipo === "egreso"
        ? await crearEgreso(formData)
        : await crearMovimiento(formData);

    setEnviando(false);

    if (resultado.ok) {
      setMensaje({ tipo: "ok", texto: "Movimiento cargado correctamente." });
      (document.getElementById("form-movimiento") as HTMLFormElement)?.reset();
    } else {
      setMensaje({ tipo: "error", texto: resultado.error });
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-6">
        {(["ingreso", "descarte", "egreso"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`px-3 py-1.5 rounded text-sm capitalize ${
              tipo === t
                ? "bg-brand-navy text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <form id="form-movimiento" action={handleSubmit} className="space-y-4">
        <input type="hidden" name="tipo" value={tipo} />

        {tipo === "ingreso" ? (
          <>
            <Campo label="Planta">
              <select name="planta_id" required className="input">
                <option value="">Seleccionar…</option>
                {plantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Producto">
              <select name="producto_id" required className="input">
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Productor">
              <select name="productor_id" required className="input">
                <option value="">Seleccionar…</option>
                {productores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Estado">
              <select name="estado" defaultValue="natural" className="input">
                <option value="natural">Natural</option>
                <option value="procesado">Procesado</option>
              </select>
            </Campo>

            <Campo label="Número de CP">
              <input name="numero_cp" className="input" />
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                defaultValue={hoy}
                required
                className="input"
              />
            </Campo>
          </>
        ) : tipo === "egreso" ? (
          <>
            <Campo label="Planta (de dónde sale)">
              <select name="planta_id" required className="input">
                <option value="">Seleccionar…</option>
                {plantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Producto">
              <select name="producto_id" required className="input">
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Productor (opcional, solo a modo de registro)">
              <select name="productor_id" className="input">
                <option value="">No especificar</option>
                {productores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                defaultValue={hoy}
                required
                className="input"
              />
            </Campo>
          </>
        ) : (
          <>
            <Campo label="Lote">
              <select name="lote_id" required className="input">
                <option value="">Seleccionar…</option>
                {lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {nombreDe(l.plantas)} · {nombreDe(l.productos)} ·{" "}
                    {nombreDe(l.productores)}
                    {l.numero_cp ? ` · CP ${l.numero_cp}` : ""} ({l.estado})
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Motivo">
              <select
                name="motivo"
                value={motivoDescarte}
                onChange={(e) => setMotivoDescarte(e.target.value)}
                className="input"
              >
                <option value="procesamiento">
                  Procesamiento (pasa de natural a procesado)
                </option>
                <option value="otro">Otro</option>
              </select>
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                defaultValue={hoy}
                required
                className="input"
              />
            </Campo>
          </>
        )}

        <Campo label="Observaciones">
          <textarea name="observaciones" className="input" rows={2} />
        </Campo>

        {mensaje && (
          <p
            className={
              mensaje.tipo === "ok" ? "text-green-700 text-sm" : "text-red-600 text-sm"
            }
          >
            {mensaje.texto}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="bg-brand-green hover:bg-brand-green-dark text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {enviando ? "Guardando…" : "Guardar movimiento"}
        </button>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
