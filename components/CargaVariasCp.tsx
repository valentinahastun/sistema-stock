"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { crearEgreso, crearIngreso, buscarCpCargada } from "@/app/movimientos/actions";
import {
  buscarEnCatalogo,
  conAlias,
  detectarProductoId,
  sugerirProductor,
  type Catalogo,
  type DatosCp,
  type LoteConProductor,
} from "@/components/MovimientoForm";
import { normalizarCv } from "@/lib/cv";
import { leerBolsas } from "@/lib/bolsas";

type TipoLote = "egreso" | "ingreso";

type Fila = {
  key: string;
  archivo: string;
  datos: DatosCp;
  incluir: boolean;
  numero_cp: string;
  fecha: string;
  planta_id: string;
  producto_id: string;
  productor_id: string;
  cantidad: string;
  destino: string;
  b25: string;
  b50: string;
  bb: string;
  repetida: string | null; // texto si la CP ya está cargada
  avisos: string[]; // no frenan
  resultado: { ok: boolean; texto: string } | null;
};

const tn3 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// Carga de varias CP de una misma operación: se leen todas, se arma una fila
// por camión con lo que se pudo completar y se guardan juntas las que están listas.
export default function CargaVariasCp({
  plantas,
  productos,
  productores,
  stock,
  lotesStock,
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  productores: Catalogo[];
  stock: { planta_id: string; producto_id: string; tn: number }[];
  lotesStock: LoteConProductor[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoLote>("egreso");
  const [cv, setCv] = useState("");
  const [estado, setEstado] = useState<"natural" | "procesado">("natural");
  const [controlo, setControlo] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [leyendo, setLeyendo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cvNorm = normalizarCv(cv);
  const sinDescarte = productos.filter((p) => !/^descarte/i.test(p.nombre.trim()));

  function armarFila(archivo: string, d: DatosCp, t: TipoLote): Fila {
    const avisos: string[] = [];
    const emisor = conAlias(d.titular);
    let planta = "";
    let productor = "";
    if (t === "egreso") {
      planta = buscarEnCatalogo(emisor, plantas)?.id ?? "";
    } else {
      productor = buscarEnCatalogo(emisor, productores)?.id ?? "";
      planta = buscarEnCatalogo(conAlias(d.destinoNombre), plantas)?.id ?? "";
    }
    let producto =
      detectarProductoId(d.granoTipo, productos, t === "egreso" && planta ? { plantaId: planta, cv: cvNorm, stock, lotes: lotesStock } : null) ?? "";
    if (!producto && /colorado/i.test(d.granoTipo ?? "") && planta) {
      const con = sinDescarte.filter(
        (p) => /colorado/i.test(p.nombre) && stock.some((x) => x.planta_id === planta && x.producto_id === p.id && x.tn > 0)
      );
      if (con.length === 1) producto = con[0].id;
    }
    if (t === "egreso" && planta) {
      const r = sugerirProductor({
        plantaId: planta,
        productoId: producto,
        cv: cvNorm,
        lotes: lotesStock,
        productores,
        plantas,
        productos,
        pistas: [
          { nombre: plantas.find((p) => p.id === planta)?.nombre ?? null, de: "la planta" },
          { nombre: emisor, de: "el titular de la CP" },
          { nombre: d.productor ?? null, de: "el remitente productor de la CP" },
        ],
      });
      productor = r.id;
      r.notas.filter((n) => n.tipo === "aviso").forEach((n) => avisos.push(n.texto));
    }
    const kg = t === "ingreso" ? d.pesoNetoDescargaKg : d.pesoNetoCargaKg;
    const fecha = (t === "ingreso" ? d.fechaDescarga : d.fechaPartida) ?? d.fecha ?? "";
    const lb = leerBolsas(d.observaciones, kg);
    if (lb.aviso) avisos.push(lb.aviso);
    if (t === "ingreso" && d.pesoNetoCargaKg && d.pesoNetoDescargaKg) {
      const dif = Math.round(d.pesoNetoCargaKg - d.pesoNetoDescargaKg);
      if (Math.abs(dif) > 100) avisos.push(`Cargado ${d.pesoNetoCargaKg} kg, descargado ${d.pesoNetoDescargaKg} kg: ${Math.abs(dif)} kg de diferencia.`);
    }
    return {
      key: `${archivo}-${Math.random()}`,
      archivo,
      datos: d,
      incluir: true,
      numero_cp: d.numeroCpe ?? "",
      fecha,
      planta_id: planta,
      producto_id: producto,
      productor_id: productor,
      cantidad: kg ? (kg / 1000).toFixed(3) : "",
      destino: d.destino ?? "",
      b25: lb.bolsas_25 ? String(lb.bolsas_25) : "",
      b50: lb.bolsas_50 ? String(lb.bolsas_50) : "",
      bb: lb.big_bags ? String(lb.big_bags) : "",
      repetida: null,
      avisos,
      resultado: null,
    };
  }

  async function leer(files: FileList | null) {
    if (!files?.length) return;
    const lista = Array.from(files);
    const nuevas: Fila[] = [];
    for (let i = 0; i < lista.length; i++) {
      setLeyendo(`Leyendo ${i + 1} de ${lista.length}…`);
      const f = lista[i];
      try {
        const fd = new FormData();
        fd.append("archivo", f);
        const r = await fetch("/api/cp/parse", { method: "POST", body: fd });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "No se pudo leer");
        const fila = armarFila(f.name, j.datos as DatosCp, tipo);
        if (fila.numero_cp) {
          const rep = await buscarCpCargada(fila.numero_cp, tipo).catch(() => []);
          if (rep.length) {
            fila.repetida = "Esta CP ya está cargada";
            fila.incluir = false;
          }
        }
        nuevas.push(fila);
      } catch (e) {
        nuevas.push({
          ...armarFila(f.name, {} as DatosCp, tipo),
          incluir: false,
          avisos: [`No se pudo leer el PDF: ${(e as Error).message}`],
        });
      }
    }
    setFilas((prev) => [...prev, ...nuevas].sort((a, b) => a.numero_cp.localeCompare(b.numero_cp)));
    setLeyendo("");
  }

  // Lo que falta en cada fila para poder guardarla
  function faltan(f: Fila): string[] {
    const x: string[] = [];
    if (!f.planta_id) x.push("planta");
    if (!f.producto_id) x.push(/colorado/i.test(f.datos.granoTipo ?? "") ? "producto (¿Dark o Light?)" : "producto");
    if (tipo === "ingreso" && !f.productor_id) x.push("productor");
    if (!(Number(f.cantidad) > 0)) x.push(tipo === "ingreso" ? "kg descargados" : "kg");
    if (!f.fecha) x.push("fecha");
    return x;
  }

  // Egresos: stock que va quedando por planta/producto si se guardan las filas en orden
  const excesos = useMemo(() => {
    const queda = new Map<string, number>();
    stock.forEach((s) => queda.set(`${s.planta_id}-${s.producto_id}`, s.tn));
    const out = new Map<string, number>();
    if (tipo !== "egreso") return out;
    filas
      .filter((f) => f.incluir && !f.resultado?.ok && f.planta_id && f.producto_id)
      .forEach((f) => {
        const k = `${f.planta_id}-${f.producto_id}`;
        const antes = queda.get(k) ?? 0;
        const kg = Math.round((Number(f.cantidad) - antes) * 1000);
        if (kg > 0) out.set(f.key, kg);
        queda.set(k, Math.max(0, antes - Number(f.cantidad)));
      });
    return out;
  }, [filas, stock, tipo]);

  const lista = (f: Fila) => faltan(f).length === 0 && !f.repetida && (excesos.get(f.key) ?? 0) <= 200;
  const aGuardar = filas.filter((f) => f.incluir && !f.resultado?.ok && lista(f));

  function cambiar(key: string, campos: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...campos } : f)));
  }

  async function guardar() {
    if (tipo === "egreso" && cv.trim() && !cvNorm) return;
    setGuardando(true);
    for (const f of aGuardar) {
      const fd = new FormData();
      fd.append("planta_id", f.planta_id);
      fd.append("producto_id", f.producto_id);
      fd.append("productor_id", f.productor_id);
      fd.append("numero_cp", f.numero_cp);
      fd.append("transportista", f.datos.transportista ?? "");
      fd.append("chofer", f.datos.chofer ?? "");
      fd.append("patente", f.datos.patente ?? "");
      fd.append("controlo_carga", controlo);
      fd.append("cantidad", f.cantidad);
      fd.append("fecha", f.fecha);
      fd.append("observaciones", "");
      fd.append("bolsas_25", f.b25);
      fd.append("bolsas_50", f.b50);
      fd.append("big_bags", f.bb);
      if (tipo === "egreso") {
        fd.append("destino", f.destino);
        fd.append("cv", cv);
        if (f.datos.pesoNetoDescargaKg) {
          fd.append("arribo_descargado_kg", String(f.datos.pesoNetoDescargaKg));
          fd.append("arribo_cargado_kg", String(f.datos.pesoNetoCargaKg ?? ""));
          fd.append("arribo_fecha", f.datos.fechaDescarga ?? "");
        }
      } else {
        fd.append("estado", estado);
      }
      const r = tipo === "egreso" ? await crearEgreso(fd) : await crearIngreso(fd);
      cambiar(f.key, { resultado: r.ok ? { ok: true, texto: "Guardada" } : { ok: false, texto: r.error } });
    }
    setGuardando(false);
    router.refresh();
  }

  const opciones = (lista: Catalogo[]) =>
    lista.map((o) => (
      <option key={o.id} value={o.id}>
        {o.nombre}
      </option>
    ));

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mb-4 inline-flex items-center gap-2 rounded-lg border border-brand-green px-4 py-2 text-sm font-medium text-brand-green hover:bg-brand-green-light"
      >
        📑 Cargar varias CP juntas
      </button>
    );
  }

  return (
    <div className="mb-6 bg-white rounded-lg shadow p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-brand-navy">Cargar varias CP juntas</h2>
        <button type="button" onClick={() => { setAbierto(false); setFilas([]); }} className="text-sm text-gray-500 underline">
          Cerrar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <label className="space-y-1">
          <span className="text-xs text-gray-500">Tipo</span>
          <select
            className="input"
            value={tipo}
            disabled={filas.length > 0}
            onChange={(e) => setTipo(e.target.value as TipoLote)}
          >
            <option value="egreso">Egresos</option>
            <option value="ingreso">Ingresos</option>
          </select>
        </label>
        {tipo === "egreso" ? (
          <label className="space-y-1">
            <span className="text-xs text-gray-500">CV de la operación (para todas)</span>
            <input className="input" placeholder="Ej.: 26-124" value={cv} onChange={(e) => setCv(e.target.value)} disabled={filas.length > 0} />
            {cv.trim() && !cvNorm && <span className="text-xs text-red-600">No entiendo ese CV</span>}
          </label>
        ) : (
          <label className="space-y-1">
            <span className="text-xs text-gray-500">Estado (para todas)</span>
            <select className="input" value={estado} onChange={(e) => setEstado(e.target.value as "natural" | "procesado")}>
              <option value="natural">Natural</option>
              <option value="procesado">Procesado</option>
            </select>
          </label>
        )}
        <label className="space-y-1">
          <span className="text-xs text-gray-500">Controló la carga (opcional)</span>
          <input className="input" value={controlo} onChange={(e) => setControlo(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-gray-500">CP (PDF)</span>
          <span className={`flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium cursor-pointer ${leyendo ? "bg-gray-200 text-gray-500" : "bg-brand-green text-white"}`}>
            {leyendo || "📄 Elegir los PDF"}
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              disabled={!!leyendo || (tipo === "egreso" && !!cv.trim() && !cvNorm)}
              onChange={(e) => {
                leer(e.target.files);
                e.target.value = "";
              }}
            />
          </span>
        </label>
      </div>
      {tipo === "egreso" && !cv.trim() && filas.length === 0 && (
        <p className="text-xs text-amber-700">Poné el CV antes de subir las CP: con eso se elige el productor y baja lo comprometido.</p>
      )}

      {filas.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b text-gray-500">
                  <th className="p-1.5"></th>
                  <th className="p-1.5">CP</th>
                  <th className="p-1.5">Fecha</th>
                  <th className="p-1.5">Planta</th>
                  <th className="p-1.5">Producto</th>
                  <th className="p-1.5">Productor</th>
                  <th className="p-1.5 text-right">Tn</th>
                  <th className="p-1.5">Bolsas 25/50/BB</th>
                  <th className="p-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const fal = faltan(f);
                  const exceso = excesos.get(f.key) ?? 0;
                  const guardada = f.resultado?.ok;
                  return (
                    <tr key={f.key} className={`border-b align-top ${guardada ? "bg-emerald-50/50" : ""}`}>
                      <td className="p-1.5">
                        <input
                          type="checkbox"
                          checked={f.incluir}
                          disabled={guardada}
                          onChange={(e) => cambiar(f.key, { incluir: e.target.checked })}
                        />
                      </td>
                      <td className="p-1.5 whitespace-nowrap">
                        {f.numero_cp || "—"}
                        <div className="text-gray-400">{f.datos.patente ?? ""}</div>
                      </td>
                      <td className="p-1.5">
                        <input type="date" className="input text-xs py-1" value={f.fecha} disabled={guardada} onChange={(e) => cambiar(f.key, { fecha: e.target.value })} />
                      </td>
                      <td className="p-1.5">
                        <select className="input text-xs py-1" value={f.planta_id} disabled={guardada} onChange={(e) => cambiar(f.key, { planta_id: e.target.value })}>
                          <option value="">Elegir…</option>
                          {opciones(plantas)}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <select className="input text-xs py-1" value={f.producto_id} disabled={guardada} onChange={(e) => cambiar(f.key, { producto_id: e.target.value })}>
                          <option value="">Elegir…</option>
                          {opciones(sinDescarte)}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <select className="input text-xs py-1" value={f.productor_id} disabled={guardada} onChange={(e) => cambiar(f.key, { productor_id: e.target.value })}>
                          <option value="">{tipo === "ingreso" ? "Elegir…" : "No especificar"}</option>
                          {opciones(productores)}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="0.001"
                          className="input text-xs py-1 w-24 text-right"
                          value={f.cantidad}
                          disabled={guardada}
                          onChange={(e) => cambiar(f.key, { cantidad: e.target.value })}
                        />
                      </td>
                      <td className="p-1.5 whitespace-nowrap">
                        {[f.b25, f.b50, f.bb].map((b) => b || "—").join(" / ")}
                      </td>
                      <td className="p-1.5 min-w-[180px]">
                        {f.resultado ? (
                          <span className={f.resultado.ok ? "text-green-700 font-medium" : "text-red-600"}>
                            {f.resultado.ok ? "✓ " : "✗ "}
                            {f.resultado.texto}
                          </span>
                        ) : f.repetida ? (
                          <span className="text-amber-700">⚠ {f.repetida} (no se carga)</span>
                        ) : fal.length ? (
                          <span className="text-amber-700">⚠ Falta: {fal.join(", ")}</span>
                        ) : exceso > 200 ? (
                          <span className="text-red-600">✗ Supera el stock por {exceso.toLocaleString("es-AR")} kg</span>
                        ) : (
                          <span className="text-green-700">✓ Lista</span>
                        )}
                        {!f.resultado && exceso > 0 && exceso <= 200 && (
                          <div className="text-amber-700">{exceso} kg de diferencia de balanza: deja el stock en 0</div>
                        )}
                        {!f.resultado && f.datos.pesoNetoDescargaKg && tipo === "egreso" && (
                          <div className="text-emerald-700">CPE confirmada: guarda también el arribo</div>
                        )}
                        {!f.resultado && f.avisos.map((a, i) => (
                          <div key={i} className="text-amber-700">{a}</div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={guardando || aGuardar.length === 0}
              onClick={guardar}
              className="rounded-lg bg-brand-green text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {guardando ? "Guardando…" : `Guardar las ${aGuardar.length} listas`}
            </button>
            <span className="text-xs text-gray-500">
              {filas.filter((f) => f.resultado?.ok).length} guardadas · {filas.filter((f) => !f.resultado?.ok && !lista(f)).length} para revisar ·
              total {tn3(aGuardar.reduce((s, f) => s + Number(f.cantidad || 0), 0))} tn a guardar
            </span>
          </div>
        </>
      )}
    </div>
  );
}
