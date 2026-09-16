"use client";

import { useEffect, useRef, useState } from "react";
import { guardarCalidad } from "@/app/calidad/actions";

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

export type LoteParaCalidad = {
  id: string;
  numero_cp: string | null;
  estado: string;
  plantas: Rel;
  productos: Rel;
  productores: Rel;
  tieneCalidad: boolean;
};

export type OpcionCatalogo = { id: string; nombre: string };

const CLAVE_BORRADOR = "calidad-draft-v1";

type Borrador = {
  lote_id: string;
  planta_id: string;
  producto_id: string;
  productor_id: string;
  numero_contrato: string;
  fecha: string;
  pct_bajo_zaranda: string;
  pct_partidos: string;
  pct_arrugados: string;
  pct_otros_granos: string;
};

function borradorVacio(hoy: string): Borrador {
  return {
    lote_id: "",
    planta_id: "",
    producto_id: "",
    productor_id: "",
    numero_contrato: "",
    fecha: hoy,
    pct_bajo_zaranda: "",
    pct_partidos: "",
    pct_arrugados: "",
    pct_otros_granos: "",
  };
}

export default function CalidadForm({
  lotes,
  plantas,
  productos,
  productores,
}: {
  lotes: LoteParaCalidad[];
  plantas: OpcionCatalogo[];
  productos: OpcionCatalogo[];
  productores: OpcionCatalogo[];
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [campos, setCampos] = useState<Borrador>(() => borradorVacio(hoy));
  const [mensaje, setMensaje] = useState<
    { tipo: "ok" | "error" | "pendiente"; texto: string } | null
  >(null);
  const [enviando, setEnviando] = useState(false);
  const [huboBorrador, setHuboBorrador] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formDataPendiente = useRef<FormData | null>(null);

  // Al montar, si hay un borrador guardado (por ejemplo porque se cerró
  // la página sin señal), lo recuperamos. Las fotos no se pueden guardar
  // en el navegador así que hay que volver a sacarlas.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_BORRADOR);
      if (guardado) {
        const datos = JSON.parse(guardado) as Borrador;
        setCampos(datos);
        setHuboBorrador(true);
      }
    } catch {
      // localStorage no disponible o dato corrupto: seguimos con el formulario vacío.
    }
  }, []);

  // Autoguardado del borrador (todo menos las fotos) cada vez que cambia algo.
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(campos));
    } catch {
      // si no se puede guardar, no pasa nada grave: solo no hay borrador.
    }
  }, [campos]);

  function limpiarBorrador() {
    try {
      localStorage.removeItem(CLAVE_BORRADOR);
    } catch {
      // nada que hacer
    }
    setHuboBorrador(false);
  }

  function actualizar<K extends keyof Borrador>(campo: K, valor: Borrador[K]) {
    setCampos((prev) => ({ ...prev, [campo]: valor }));
  }

  async function intentarEnviar(formData: FormData) {
    setEnviando(true);

    let resultado;
    try {
      resultado = await guardarCalidad(formData);
    } catch {
      // Esto salta típicamente cuando no hay señal: la conexión al
      // servidor falla directamente, no llega a responder. Dejamos el
      // formulario tal cual (con la foto ya elegida) y reintentamos
      // solo cuando el celular avisa que volvió la conexión.
      setEnviando(false);
      formDataPendiente.current = formData;
      setMensaje({
        tipo: "pendiente",
        texto:
          "No hay señal ahora mismo. Quedó guardado en el formulario y se va a enviar solo apenas vuelva la conexión (no cierres esta página).",
      });
      window.addEventListener("online", reintentarAlVolverSenal, { once: true });
      return;
    }

    setEnviando(false);

    if (resultado.ok) {
      limpiarBorrador();
      setCampos(borradorVacio(hoy));
      formRef.current?.reset();
      formDataPendiente.current = null;
      setMensaje({ tipo: "ok", texto: "Registro de calidad guardado." });
    } else {
      setMensaje({ tipo: "error", texto: resultado.error });
    }
  }

  function reintentarAlVolverSenal() {
    if (formDataPendiente.current) {
      setMensaje({ tipo: "pendiente", texto: "Volvió la señal, enviando…" });
      intentarEnviar(formDataPendiente.current);
    }
  }

  async function handleSubmit(formData: FormData) {
    setMensaje(null);
    await intentarEnviar(formData);
  }

  const hayLotes = lotes.length > 0;
  const loteElegido = hayLotes ? campos.lote_id : "";
  const esSuelto = !loteElegido;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="font-medium text-brand-navy mb-1">Cargar calidad</h2>
      <p className="text-xs text-gray-500 mb-4">
        Sacá la foto ahí mismo con el celular. Si el lote todavía no está
        cargado en el sistema, elegí planta y producto igual: se puede
        vincular al lote más adelante.
      </p>

      {huboBorrador && (
        <p className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-3 py-2 mb-4">
          Recuperamos un borrador que habías empezado a cargar. Revisá los
          datos y volvé a elegir la foto antes de guardar.
        </p>
      )}

      <form ref={formRef} id="form-calidad" action={handleSubmit} className="space-y-4">
        {hayLotes && (
          <Campo label="Lote (si ya está cargado)">
            <select
              name="lote_id"
              className="input"
              value={campos.lote_id}
              onChange={(e) => actualizar("lote_id", e.target.value)}
            >
              <option value="">Todavía no está cargado / no lo sé</option>
              {lotes.map((l) => (
                <option key={l.id} value={l.id}>
                  {nombreDe(l.plantas)} · {nombreDe(l.productos)} ·{" "}
                  {nombreDe(l.productores)}
                  {l.numero_cp ? ` · CP ${l.numero_cp}` : ""} ({l.estado})
                  {l.tieneCalidad ? " — ya tiene calidad cargada" : ""}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {esSuelto && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 rounded p-3">
            <Campo label="Planta">
              <select
                name="planta_id"
                required={esSuelto}
                className="input"
                value={campos.planta_id}
                onChange={(e) => actualizar("planta_id", e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {plantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Producto">
              <select
                name="producto_id"
                required={esSuelto}
                className="input"
                value={campos.producto_id}
                onChange={(e) => actualizar("producto_id", e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Productor (opcional)">
              <select
                name="productor_id"
                className="input"
                value={campos.productor_id}
                onChange={(e) => actualizar("productor_id", e.target.value)}
              >
                <option value="">No lo sé todavía</option>
                {productores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Número de contrato (si tuviera)">
              <input
                name="numero_contrato"
                type="text"
                className="input"
                value={campos.numero_contrato}
                onChange={(e) => actualizar("numero_contrato", e.target.value)}
              />
            </Campo>
          </div>
        )}

        <Campo label="Fecha">
          <input
            name="fecha"
            type="date"
            required
            className="input"
            value={campos.fecha}
            onChange={(e) => actualizar("fecha", e.target.value)}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-4">
          <Campo label="Bajo zaranda (%)">
            <input
              name="pct_bajo_zaranda"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_bajo_zaranda}
              onChange={(e) => actualizar("pct_bajo_zaranda", e.target.value)}
            />
          </Campo>
          <Campo label="Partidos (%)">
            <input
              name="pct_partidos"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_partidos}
              onChange={(e) => actualizar("pct_partidos", e.target.value)}
            />
          </Campo>
          <Campo label="Arrugados (%)">
            <input
              name="pct_arrugados"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_arrugados}
              onChange={(e) => actualizar("pct_arrugados", e.target.value)}
            />
          </Campo>
          <Campo label="Otros granos (%)">
            <input
              name="pct_otros_granos"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_otros_granos}
              onChange={(e) => actualizar("pct_otros_granos", e.target.value)}
            />
          </Campo>
        </div>

        <Campo label="Fotos">
          <input
            name="fotos"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="input"
          />
        </Campo>

        {mensaje && (
          <p
            className={
              mensaje.tipo === "ok"
                ? "text-green-700 text-sm"
                : mensaje.tipo === "pendiente"
                ? "text-amber-700 text-sm"
                : "text-red-600 text-sm"
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
          {enviando ? "Guardando…" : "Guardar calidad"}
        </button>

        {mensaje?.tipo === "pendiente" && formDataPendiente.current && (
          <button
            type="button"
            onClick={() => reintentarAlVolverSenal()}
            className="ml-2 border border-amber-300 text-amber-800 rounded px-4 py-2 text-sm hover:bg-amber-50"
          >
            Reintentar ahora
          </button>
        )}
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
