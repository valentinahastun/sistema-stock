"use client";

import { useEffect, useRef, useState } from "react";
import { guardarCalidad } from "@/app/calidad/actions";

// Se mantiene exportado por compatibilidad con quien importe el tipo,
// aunque el formulario ya no elige lote: toda carga de calidad queda
// "suelta" (planta/producto/productor/contrato) y se vincula a un lote
// después, desde la sección de administrador en /calidad.
type Rel = { nombre: string }[] | { nombre: string } | null;

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

// v2: cambió el set de parámetros de calidad (ver migración
// 0010_calidad_parametros.sql), así que se cambia la clave para no
// levantar un borrador viejo con campos que ya no existen.
const CLAVE_BORRADOR = "calidad-draft-v2";

// Los 7 campos que suman "daños totales" (ver columna calculada en la
// base). Se usa esta lista tanto para el cálculo en vivo como para
// mandarlos en el mismo orden que la plantilla del certificado.
const CAMPOS_DANOS = [
  "pct_partidos",
  "pct_tegumento_danado",
  "pct_levemente_manchados",
  "pct_manchados",
  "pct_arrugados",
  "pct_otros_defectos_graves",
  "pct_otros_defectos_leves",
] as const;

type Borrador = {
  planta_id: string;
  producto_id: string;
  productor_id: string;
  numero_contrato: string;
  fecha: string;
  pct_partidos: string;
  pct_tegumento_danado: string;
  pct_levemente_manchados: string;
  pct_manchados: string;
  pct_arrugados: string;
  pct_otros_defectos_graves: string;
  pct_otros_defectos_leves: string;
  pct_materia_extrana: string;
  pct_humedad: string;
  pct_bajo_zaranda: string;
  observaciones: string;
};

function borradorVacio(hoy: string): Borrador {
  return {
    planta_id: "",
    producto_id: "",
    productor_id: "",
    numero_contrato: "",
    fecha: hoy,
    pct_partidos: "",
    pct_tegumento_danado: "",
    pct_levemente_manchados: "",
    pct_manchados: "",
    pct_arrugados: "",
    pct_otros_defectos_graves: "",
    pct_otros_defectos_leves: "",
    pct_materia_extrana: "",
    pct_humedad: "",
    pct_bajo_zaranda: "",
    observaciones: "",
  };
}

export default function CalidadForm({
  plantas,
  productos,
  productores,
}: {
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
        const datos = JSON.parse(guardado) as Partial<Borrador>;
        setCampos({ ...borradorVacio(hoy), ...datos });
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

  // Se recalcula en vivo a medida que se escribe, para que se vea igual
  // a como después va a quedar guardado (lo calcula la base de datos).
  const danosTotales = CAMPOS_DANOS.reduce((acc, campo) => {
    const n = Number(campos[campo]);
    return acc + (Number.isNaN(n) ? 0 : n);
  }, 0);

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

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="font-medium text-brand-navy mb-1">Cargar calidad</h2>
      <p className="text-xs text-gray-500 mb-4">
        Sacá la foto ahí mismo con el celular. No hace falta elegir el lote:
        con planta, producto, productor y contrato (si lo tenés) alcanza. Se
        vincula al lote más adelante desde el panel de administración.
      </p>

      {huboBorrador && (
        <p className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-3 py-2 mb-4">
          Recuperamos un borrador que habías empezado a cargar. Revisá los
          datos y volvé a elegir la foto antes de guardar.
        </p>
      )}

      <form ref={formRef} id="form-calidad" action={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 rounded p-3">
          <Campo label="Planta">
            <select
              name="planta_id"
              required
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
              required
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
          <Campo label="Partidos y quebrados / Split and broken (%)">
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
          <Campo label="Granos con tegumento dañado / Skin damage (%)">
            <input
              name="pct_tegumento_danado"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_tegumento_danado}
              onChange={(e) => actualizar("pct_tegumento_danado", e.target.value)}
            />
          </Campo>
          <Campo label="Granos levemente manchados / Slightly stained grains (%)">
            <input
              name="pct_levemente_manchados"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_levemente_manchados}
              onChange={(e) => actualizar("pct_levemente_manchados", e.target.value)}
            />
          </Campo>
          <Campo label="Granos Manchados / Stained grains (%)">
            <input
              name="pct_manchados"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_manchados}
              onChange={(e) => actualizar("pct_manchados", e.target.value)}
            />
          </Campo>
          <Campo label="Granos arrugados / Wrinkled grains (%)">
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
          <Campo label="Otros defectos graves / Other severe defects (%)">
            <input
              name="pct_otros_defectos_graves"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_otros_defectos_graves}
              onChange={(e) => actualizar("pct_otros_defectos_graves", e.target.value)}
            />
          </Campo>
          <Campo label="Otros defectos leves / Other minor defects (%)">
            <input
              name="pct_otros_defectos_leves"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_otros_defectos_leves}
              onChange={(e) => actualizar("pct_otros_defectos_leves", e.target.value)}
            />
          </Campo>
          <Campo label="DAÑOS TOTALES / TOTAL DAMAGES (%)">
            <input
              type="number"
              disabled
              className="input bg-gray-100 text-gray-600 font-medium"
              value={danosTotales.toFixed(2)}
            />
          </Campo>
          <Campo label="Materia extraña / Foreign matter (%)">
            <input
              name="pct_materia_extrana"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_materia_extrana}
              onChange={(e) => actualizar("pct_materia_extrana", e.target.value)}
            />
          </Campo>
          <Campo label="Humedad / Moisture (%)">
            <input
              name="pct_humedad"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              className="input"
              value={campos.pct_humedad}
              onChange={(e) => actualizar("pct_humedad", e.target.value)}
            />
          </Campo>
          <Campo label="Bajo zaranda / Undersize (%)">
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
        </div>
        <p className="text-xs text-gray-400 -mt-2">
          "Daños totales" se calcula solo, sumando los 7 campos de arriba
          (no incluye materia extraña, humedad ni bajo zaranda).
        </p>

        <Campo label="Observaciones">
          <textarea
            name="observaciones"
            rows={3}
            className="input"
            placeholder="Cualquier aclaración sobre este análisis…"
            value={campos.observaciones}
            onChange={(e) => actualizar("observaciones", e.target.value)}
          />
        </Campo>

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
