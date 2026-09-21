"use client";

import { useRef, useState } from "react";
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

type DatosCp = {
  numeroCpe: string | null;
  ctg: string | null;
  chofer: string | null;
  transportista: string | null;
  patente: string | null;
  pesoNetoCargaKg: number | null;
  pesoNetoDescargaKg: number | null;
  fechaPartida: string | null;
  fechaDescarga: string | null;
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

  // Campos que se pueden autocompletar leyendo el PDF de la Carta de Porte.
  // Quedan editables: leer la CP solo ahorra tipeo, la persona sigue
  // pudiendo corregir cualquier valor antes de guardar.
  const [numeroCp, setNumeroCp] = useState("");
  const [transportista, setTransportista] = useState("");
  const [chofer, setChofer] = useState("");
  const [patente, setPatente] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [leyendoCp, setLeyendoCp] = useState(false);
  const [mensajeCp, setMensajeCp] = useState<
    { tipo: "ok" | "error"; texto: string } | null
  >(null);
  const inputCpRef = useRef<HTMLInputElement>(null);

  function limpiarCamposCp() {
    setNumeroCp("");
    setTransportista("");
    setChofer("");
    setPatente("");
    setCantidad("");
    setFecha(hoy);
    setMensajeCp(null);
    if (inputCpRef.current) inputCpRef.current.value = "";
  }

  async function handleLeerCp(archivo: File, tipoActual: "ingreso" | "egreso") {
    setLeyendoCp(true);
    setMensajeCp(null);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const res = await fetch("/api/cp/parse", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setMensajeCp({ tipo: "error", texto: json.error ?? "No se pudo leer la CP." });
        return;
      }

      const datos = json.datos as DatosCp;
      const faltantes: string[] = [];

      if (datos.numeroCpe) setNumeroCp(datos.numeroCpe);
      if (datos.transportista) setTransportista(datos.transportista);
      else faltantes.push("transportista");
      if (datos.chofer) setChofer(datos.chofer);
      else faltantes.push("chofer");
      if (datos.patente) setPatente(datos.patente);
      else faltantes.push("patente");

      const pesoKg = tipoActual === "ingreso" ? datos.pesoNetoDescargaKg : datos.pesoNetoCargaKg;
      if (pesoKg) {
        setCantidad((pesoKg / 1000).toFixed(3));
      } else {
        faltantes.push(tipoActual === "ingreso" ? "peso neto de descarga" : "peso neto de carga");
      }

      const fechaCp = tipoActual === "ingreso" ? datos.fechaDescarga : datos.fechaPartida;
      if (fechaCp) setFecha(fechaCp);

      if (faltantes.length > 0) {
        setMensajeCp({
          tipo: "error",
          texto: `Se completó lo que se pudo leer, pero faltó en el PDF: ${faltantes.join(", ")}. Completalo a mano.`,
        });
      } else {
        setMensajeCp({ tipo: "ok", texto: "Datos de la CP cargados. Revisalos antes de guardar." });
      }
    } catch (e) {
      setMensajeCp({ tipo: "error", texto: `No se pudo leer el PDF: ${(e as Error).message}` });
    } finally {
      setLeyendoCp(false);
    }
  }

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
      limpiarCamposCp();
    } else {
      setMensaje({ tipo: "error", texto: resultado.error });
    }
  }

  function CampoCp() {
    return (
      <div className="border border-dashed border-gray-300 rounded-md p-3 bg-gray-50">
        <label className="block text-sm text-gray-600 mb-1">
          Cargar Carta de Porte (PDF, opcional)
        </label>
        <input
          ref={inputCpRef}
          type="file"
          accept="application/pdf"
          disabled={leyendoCp}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            if (archivo && (tipo === "ingreso" || tipo === "egreso")) {
              handleLeerCp(archivo, tipo);
            }
          }}
          className="text-sm"
        />
        {leyendoCp && <p className="text-xs text-gray-500 mt-1">Leyendo PDF…</p>}
        {mensajeCp && (
          <p
            className={`text-xs mt-1 ${
              mensajeCp.tipo === "ok" ? "text-green-700" : "text-amber-700"
            }`}
          >
            {mensajeCp.texto}
          </p>
        )}
      </div>
    );
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
            <CampoCp />

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
              <input
                name="numero_cp"
                className="input"
                value={numeroCp}
                onChange={(e) => setNumeroCp(e.target.value)}
              />
            </Campo>

            <Campo label="Transportista">
              <input
                name="transportista"
                className="input"
                value={transportista}
                onChange={(e) => setTransportista(e.target.value)}
              />
            </Campo>

            <Campo label="Chofer">
              <input
                name="chofer"
                className="input"
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
              />
            </Campo>

            <Campo label="Patente">
              <input
                name="patente"
                className="input"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
              />
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                required
                className="input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
          </>
        ) : tipo === "egreso" ? (
          <>
            <CampoCp />

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

            <Campo label="Número de CP">
              <input
                name="numero_cp"
                className="input"
                value={numeroCp}
                onChange={(e) => setNumeroCp(e.target.value)}
              />
            </Campo>

            <Campo label="Transportista">
              <input
                name="transportista"
                className="input"
                value={transportista}
                onChange={(e) => setTransportista(e.target.value)}
              />
            </Campo>

            <Campo label="Chofer">
              <input
                name="chofer"
                className="input"
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
              />
            </Campo>

            <Campo label="Patente">
              <input
                name="patente"
                className="input"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
              />
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                required
                className="input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
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
