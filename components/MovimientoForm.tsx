"use client";

import { useRef, useState } from "react";
import { crearIngreso, crearMovimientoDirecto, crearEgreso } from "@/app/movimientos/actions";

type Catalogo = { id: string; nombre: string };

type DatosCp = {
  numeroCpe: string | null;
  ctg: string | null;
  chofer: string | null;
  transportista: string | null;
  patente: string | null;
  pesoNetoCargaKg: number | null;
  pesoNetoDescargaKg: number | null;
  fecha: string | null;
  titular: string | null;
  productor: string | null;
  destino: string | null;
  granoTipo: string | null;
};

type Tipo = "ingreso" | "egreso" | "directo";

// Para el movimiento Directo, el producto (que en la CP viene como texto
// libre en "Grano / Poroto Tipo") se intenta asociar con las reglas que
// confirmó el usuario. Reglas en orden: la primera que matchea gana. Las
// variedades con nombre propio en la CP (Alubia, Negro, Cranberry,
// Garbanzo, Mung) matchean por ese nombre; Adzuki no tiene nombre propio
// en la CP (la describen como "distinto" del oval blanco), así que es el
// catch-all: cualquier "poroto" que no haya matcheado antes. Colorado es
// un caso aparte: la CP no distingue Dark de Light, así que nunca se
// autocompleta (lo elige la persona a mano), aunque diga "poroto". El
// campo queda siempre editable para corregir cualquiera de estos casos
// antes de guardar.
const REGLAS_PRODUCTO_DIRECTO: { patron: RegExp; nombreProducto: string }[] = [
  { patron: /alubia/i, nombreProducto: "Poroto Alubia" },
  { patron: /negro/i, nombreProducto: "Poroto Negro" },
  { patron: /cranberry/i, nombreProducto: "Poroto Cranberry" },
  { patron: /garbanzo/i, nombreProducto: "Garbanzo" },
  { patron: /mung/i, nombreProducto: "Poroto Mungo" },
  { patron: /poroto/i, nombreProducto: "Poroto Adzuki" },
];

function detectarProductoId(granoTipo: string | null, productos: Catalogo[]): string | null {
  if (!granoTipo) return null;
  // Colorado Dark vs Light no se distingue en el texto de la CP: mejor no
  // adivinar y que se elija a mano, en vez de arriesgar el catch-all de Adzuki.
  if (/colorado/i.test(granoTipo)) return null;
  for (const regla of REGLAS_PRODUCTO_DIRECTO) {
    if (regla.patron.test(granoTipo)) {
      const match = productos.find(
        (p) => p.nombre.trim().toLowerCase() === regla.nombreProducto.toLowerCase()
      );
      if (match) return match.id;
    }
  }
  return null;
}

export default function MovimientoForm({
  plantas,
  productos,
  productores,
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  productores: Catalogo[];
}) {
  const [tipo, setTipo] = useState<Tipo>("ingreso");
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
  const [cantidadDescargada, setCantidadDescargada] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [destino, setDestino] = useState("");
  const [titular, setTitular] = useState("");
  const [productor, setProductor] = useState("");
  const [productoIdDirecto, setProductoIdDirecto] = useState("");
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
    setCantidadDescargada("");
    setFecha(hoy);
    setDestino("");
    setTitular("");
    setProductor("");
    setProductoIdDirecto("");
    setMensajeCp(null);
    if (inputCpRef.current) inputCpRef.current.value = "";
  }

  async function handleLeerCp(archivo: File, tipoActual: Tipo) {
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

      // Ingreso toma el peso descargado (lo que efectivamente entró);
      // egreso toma el peso cargado (el que figura siempre en la sección B
      // de la CP, no depende de que ya se haya descargado). Directo
      // muestra los dos, para poder ver si hubo diferencia en el camino
      // aunque la mercadería nunca haya pasado por el depósito propio.
      if (tipoActual === "directo") {
        if (datos.pesoNetoCargaKg) {
          setCantidad((datos.pesoNetoCargaKg / 1000).toFixed(3));
        } else {
          faltantes.push("peso neto de carga");
        }
        if (datos.pesoNetoDescargaKg) {
          setCantidadDescargada((datos.pesoNetoDescargaKg / 1000).toFixed(3));
        }

        const productoDetectado = detectarProductoId(datos.granoTipo, productos);
        if (productoDetectado) {
          setProductoIdDirecto(productoDetectado);
        } else {
          faltantes.push("producto (no se pudo asociar, elegilo a mano)");
        }
      } else {
        const pesoKg = tipoActual === "ingreso" ? datos.pesoNetoDescargaKg : datos.pesoNetoCargaKg;
        if (pesoKg) {
          setCantidad((pesoKg / 1000).toFixed(3));
        } else {
          faltantes.push(tipoActual === "ingreso" ? "peso neto de descarga" : "peso neto de carga");
        }
      }

      // La fecha siempre es la de emisión de la CP (arriba a la derecha
      // del documento), sea cual sea el tipo de movimiento.
      if (datos.fecha) setFecha(datos.fecha);

      if (tipoActual === "egreso" || tipoActual === "directo") {
        if (datos.destino) setDestino(datos.destino);
        else faltantes.push("destino");
      }
      if (tipoActual === "directo") {
        if (datos.titular) setTitular(datos.titular);
        else faltantes.push("titular");
        if (datos.productor) setProductor(datos.productor);
        else faltantes.push("productor");
      }

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
        : await crearMovimientoDirecto(formData);

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
            if (archivo) {
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
        {([
          { valor: "ingreso" as const, etiqueta: "Ingreso" },
          { valor: "egreso" as const, etiqueta: "Egreso" },
          { valor: "directo" as const, etiqueta: "Directo" },
        ]).map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => setTipo(t.valor)}
            className={`px-3 py-1.5 rounded text-sm ${
              tipo === t.valor
                ? "bg-brand-navy text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {t.etiqueta}
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

            <Campo label="Destino (a dónde va, según la CP)">
              <input
                name="destino"
                className="input"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
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
            <CampoCp />

            <Campo label="Producto">
              <select
                name="producto_id"
                required
                className="input"
                value={productoIdDirecto}
                onChange={(e) => setProductoIdDirecto(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Titular de la CP">
              <input
                name="titular"
                className="input"
                value={titular}
                onChange={(e) => setTitular(e.target.value)}
              />
            </Campo>

            <Campo label="Productor / remitente">
              <input
                name="productor_texto"
                className="input"
                value={productor}
                onChange={(e) => setProductor(e.target.value)}
              />
            </Campo>

            <Campo label="Destino">
              <input
                name="destino"
                className="input"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
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

            <Campo label="Cantidad cargada (toneladas)">
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

            <Campo label="Cantidad descargada (toneladas, opcional)">
              <input
                name="cantidad_descargada"
                type="number"
                step="0.001"
                min="0.001"
                className="input"
                value={cantidadDescargada}
                onChange={(e) => setCantidadDescargada(e.target.value)}
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
