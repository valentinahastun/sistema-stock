"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmarCaidaEstimada, guardarBolsas } from "@/app/stock/actions";

export type LoteDetalle = {
  lote_id: string;
  productor: string;
  numero_cp: string | null;
  estado: string;
  fecha_ingreso: string;
  stock_actual_tn: number;
  caida_pct_estimada: number | null;
  descarte_real_tn?: number; // descarte ya cargado en el lote
  bolsas_25?: number | null; // bolsas de 25 kg
  bolsas_50?: number | null; // bolsas de 50 kg
  big_bags?: number | null;
  cv?: string | null; // CV al que está comprometido el lote
  salidas_tn?: number; // egresos (por planta/producto) que se descuentan de este lote
};

export type FilaBase = {
  planta_id: string;
  planta: string;
  producto_id: string;
  producto: string;
  stockDisponibleTn: number;
  comprometidoTn: number;
  libreTn: number;
};

type Modo = "planta" | "producto";

// Vista agrupada del stock: por defecto agrupa por planta (cada planta
// es un grupo colapsado que muestra su subtotal, y al abrirlo aparecen
// sus productos), pero se puede cambiar a agrupar por producto para
// contestar la pregunta inversa ("cuánto tengo de este producto en
// total, sumando todas las plantas"). Cada fila de producto, a su vez,
// se puede abrir para ver el detalle por lote de siempre.
export default function StockAgrupado({
  filas,
  lotesPorClave,
  puedeEditar,
}: {
  filas: FilaBase[];
  lotesPorClave: Map<string, LoteDetalle[]>;
  puedeEditar: boolean;
}) {
  const [modo, setModo] = useState<Modo>("planta");

  const grupos = new Map<string, { id: string; nombre: string; filas: FilaBase[] }>();
  filas.forEach((f) => {
    const id = modo === "planta" ? f.planta_id : f.producto_id;
    const nombre = modo === "planta" ? f.planta : f.producto;
    if (!grupos.has(id)) grupos.set(id, { id, nombre, filas: [] });
    grupos.get(id)!.filas.push(f);
  });

  const listaGrupos = Array.from(grupos.values())
    .map((g) => ({
      ...g,
      filas: [...g.filas].sort((a, b) =>
        (modo === "planta" ? a.producto : a.planta).localeCompare(
          modo === "planta" ? b.producto : b.planta
        )
      ),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2 text-sm">
        <span className="text-gray-500">Agrupar por:</span>
        <button
          type="button"
          onClick={() => setModo("planta")}
          className={`px-2.5 py-1 rounded ${
            modo === "planta" ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Planta
        </button>
        <button
          type="button"
          onClick={() => setModo("producto")}
          className={`px-2.5 py-1 rounded ${
            modo === "producto" ? "bg-brand-navy text-white" : "bg-gray-100 text-gray-700"
          }`}
        >
          Producto
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">{modo === "planta" ? "Planta" : "Producto"}</th>
              <th className="px-4 py-2 text-right">Disponible (tn)</th>
              <th className="px-4 py-2 text-right">Comprometido (tn)</th>
              <th className="px-4 py-2 text-right">Libre (tn)</th>
            </tr>
          </thead>
          <tbody>
            {listaGrupos.map((g) => (
              <GrupoFila
                key={g.id}
                grupo={g}
                modo={modo}
                lotesPorClave={lotesPorClave}
                puedeEditar={puedeEditar}
              />
            ))}
            {listaGrupos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No hay stock cargado todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrupoFila({
  grupo,
  modo,
  lotesPorClave,
  puedeEditar,
}: {
  grupo: { id: string; nombre: string; filas: FilaBase[] };
  modo: Modo;
  lotesPorClave: Map<string, LoteDetalle[]>;
  puedeEditar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  const disponible = grupo.filas.reduce((acc, f) => acc + f.stockDisponibleTn, 0);
  const comprometido = grupo.filas.reduce((acc, f) => acc + f.comprometidoTn, 0);
  const libre = grupo.filas.reduce((acc, f) => acc + f.libreTn, 0);

  return (
    <>
      <tr className="border-b last:border-0 bg-gray-50">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex items-center gap-1.5 font-medium text-brand-navy hover:underline"
          >
            <span className="inline-block w-3 text-xs text-gray-400">
              {abierto ? "▾" : "▸"}
            </span>
            {grupo.nombre}
            <span className="text-xs text-gray-400 font-normal">
              ({grupo.filas.length} {modo === "planta" ? "producto" : "planta"}
              {grupo.filas.length === 1 ? "" : "s"})
            </span>
          </button>
        </td>
        <td className="px-4 py-2 text-right font-medium">{disponible.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{comprometido.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{libre.toFixed(2)}</td>
      </tr>
      {abierto &&
        grupo.filas.map((f) => (
          <FilaProducto
            key={`${f.planta_id}-${f.producto_id}`}
            etiqueta={modo === "planta" ? f.producto : f.planta}
            fila={f}
            lotes={lotesPorClave.get(`${f.planta_id}-${f.producto_id}`) ?? []}
            puedeEditar={puedeEditar}
          />
        ))}
    </>
  );
}

function FilaProducto({
  etiqueta,
  fila,
  lotes,
  puedeEditar,
}: {
  etiqueta: string;
  fila: FilaBase;
  lotes: LoteDetalle[];
  puedeEditar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-4 py-2 pl-8">
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="flex items-center gap-1.5 text-brand-navy hover:underline"
          >
            <span className="inline-block w-3 text-xs text-gray-400">
              {abierto ? "▾" : "▸"}
            </span>
            {etiqueta}
          </button>
        </td>
        <td className="px-4 py-2 text-right">{fila.stockDisponibleTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right">{fila.comprometidoTn.toFixed(2)}</td>
        <td className="px-4 py-2 text-right font-medium">{fila.libreTn.toFixed(2)}</td>
      </tr>
      {abierto && (
        <tr className="border-b last:border-0 bg-gray-50">
          <td colSpan={4} className="px-4 py-3">
            <DetalleLotes lotes={lotes} puedeEditar={puedeEditar} esDescarte={/^descarte\b/i.test(fila.producto)} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleLotes({
  lotes,
  puedeEditar,
  esDescarte,
}: {
  lotes: LoteDetalle[];
  puedeEditar: boolean;
  esDescarte: boolean; // los productos de descarte no llevan % de caída
}) {
  if (lotes.length === 0) {
    return <p className="text-xs text-gray-400">Sin lotes cargados.</p>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="px-2 py-1">Fecha</th>
          <th className="px-2 py-1">Productor</th>
          <th className="px-2 py-1">CP</th>
          <th className="px-2 py-1">CV</th>
          <th className="px-2 py-1">Estado</th>
          <th className="px-2 py-1">Bolsas</th>
          <th className="px-2 py-1 text-right">Stock actual (tn)</th>
          {!esDescarte && (
            <>
              <th className="px-2 py-1 text-right">% caída estim.</th>
              <th className="px-2 py-1 text-right">Descarte estim. (tn)</th>
              <th className="px-2 py-1 text-right">Exportable estim. (tn)</th>
              <th className="px-2 py-1"></th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {lotes.map((l) => (
          <FilaLote key={l.lote_id} lote={l} puedeEditar={puedeEditar} esDescarte={esDescarte} />
        ))}
      </tbody>
    </table>
  );
}

// El usuario puede cargar la caída de dos formas, la que le resulte más
// cómoda en cada caso: como % del stock actual del lote, o directamente
// en toneladas de descarte (cuando ya sabe el número real que salió del
// proceso). "modo" indica cuál de las dos se está usando; la otra se
// muestra en gris, calculada a partir de esa, y si el usuario la toca
// pasa a ser ella la fuente.
function FilaLote({
  lote,
  puedeEditar,
  esDescarte,
}: {
  lote: LoteDetalle;
  puedeEditar: boolean;
  esDescarte: boolean;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"pct" | "tn" | null>(
    lote.caida_pct_estimada !== null ? "pct" : null
  );
  const [pctRaw, setPctRaw] = useState(
    lote.caida_pct_estimada !== null ? String(lote.caida_pct_estimada) : ""
  );
  const [tnRaw, setTnRaw] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onChangePct(v: string) {
    setModo(v === "" ? null : "pct");
    setPctRaw(v);
    setTnRaw("");
  }

  function onChangeTn(v: string) {
    setModo(v === "" ? null : "tn");
    setTnRaw(v);
    setPctRaw("");
  }

  const pctNum = modo === "pct" && pctRaw !== "" ? Number(pctRaw) : null;
  const pctValido = pctNum !== null && !Number.isNaN(pctNum) && pctNum > 0 && pctNum <= 100;

  const tnNum = modo === "tn" && tnRaw !== "" ? Number(tnRaw) : null;
  const tnValido =
    tnNum !== null && !Number.isNaN(tnNum) && tnNum > 0 && tnNum <= lote.stock_actual_tn;

  const valido = modo === "pct" ? pctValido : modo === "tn" ? tnValido : false;

  // Lote procesado: el descarte ya está restado del stock actual, así que se
  // muestra el descarte real y lo que queda es lo exportable (no se vuelve a
  // aplicar el % sobre el stock que ya quedó).
  const procesado = lote.estado !== "natural";
  const descarteReal = lote.descarte_real_tn ?? 0;
  const pctReal =
    procesado && descarteReal > 0 ? (descarteReal / (lote.stock_actual_tn + descarteReal)) * 100 : null;

  const descarteEstimado = procesado
    ? descarteReal > 0
      ? descarteReal
      : null
    : modo === "pct" && pctValido
      ? (lote.stock_actual_tn * (pctNum as number)) / 100
      : modo === "tn" && tnValido
      ? (tnNum as number)
      : null;
  const exportableEstimado = procesado
    ? descarteReal > 0
      ? lote.stock_actual_tn
      : null
    : descarteEstimado !== null
    ? lote.stock_actual_tn - descarteEstimado
    : null;

  // Lo que se muestra en cada campo: el valor tipeado si es ese el modo
  // activo, o el equivalente calculado (gris) a partir del otro campo.
  const pctMostrado =
    modo === "tn" && tnValido
      ? (((tnNum as number) / lote.stock_actual_tn) * 100).toFixed(2)
      : pctRaw;
  const tnMostrado =
    modo === "pct" && pctValido ? (descarteEstimado as number).toFixed(2) : tnRaw;

  async function confirmar() {
    if (!valido) {
      setError("Ingresá un % (0 a 100) o las toneladas de descarte.");
      return;
    }
    const mensaje =
      modo === "pct"
        ? `Se va a cargar un descarte real de ${descarteEstimado?.toFixed(
            2
          )} tn (${pctRaw}%) en este lote (queda "procesado") y un ingreso nuevo por la misma cantidad como descarte. ¿Confirmás?`
        : `Se va a cargar un descarte real de ${tnRaw} tn en este lote (queda "procesado") y un ingreso nuevo por la misma cantidad como descarte. ¿Confirmás?`;
    const confirmado = window.confirm(mensaje);
    if (!confirmado) return;

    setConfirmando(true);
    setError(null);
    const resultado = await confirmarCaidaEstimada(
      lote.lote_id,
      modo === "pct" ? { modo: "pct", valor: pctRaw } : { modo: "tn", valor: tnRaw }
    );
    setConfirmando(false);
    if (resultado.ok) {
      router.refresh();
    } else {
      setError(resultado.error);
    }
  }

  const esNatural = lote.estado === "natural";
  const puedeCargar = esNatural && puedeEditar;

  return (
    <tr className="border-t border-gray-200 align-top">
      <td className="px-2 py-1.5 whitespace-nowrap">{lote.fecha_ingreso}</td>
      <td className="px-2 py-1.5">{lote.productor}</td>
      <td className="px-2 py-1.5">{lote.numero_cp ?? "—"}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {lote.cv ? (
          <span className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5">{lote.cv}</span>
        ) : (
          <span className="text-gray-400">libre</span>
        )}
      </td>
      <td className="px-2 py-1.5 capitalize">{lote.estado}</td>
      <td className="px-2 py-1.5">
        {lote.estado === "natural" ? "—" : <CeldaBolsas lote={lote} puedeEditar={puedeEditar} />}
      </td>
      <td className="px-2 py-1.5 text-right">
        {lote.stock_actual_tn.toFixed(2)}
        {lote.salidas_tn ? (
          <div className="text-[10px] text-gray-400">salieron {lote.salidas_tn.toFixed(2)}</div>
        ) : null}
      </td>
      {!esDescarte && (
        <>
          <td className="px-2 py-1.5 text-right">
            {puedeCargar ? (
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={pctMostrado}
                onChange={(e) => onChangePct(e.target.value)}
                className={`w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs ${
                  modo === "tn" && tnValido ? "text-gray-400" : ""
                }`}
                placeholder="—"
              />
            ) : esNatural ? (
              lote.caida_pct_estimada !== null ? `${lote.caida_pct_estimada}%` : "—"
            ) : pctReal !== null ? (
              `${pctReal.toFixed(2)}%`
            ) : (
              "—"
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            {puedeCargar ? (
              <input
                type="number"
                min="0"
                max={lote.stock_actual_tn}
                step="0.01"
                value={tnMostrado}
                onChange={(e) => onChangeTn(e.target.value)}
                className={`w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs ${
                  modo === "pct" && pctValido ? "text-gray-400" : ""
                }`}
                placeholder="—"
              />
            ) : descarteEstimado !== null ? (
              descarteEstimado.toFixed(2)
            ) : (
              "—"
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            {exportableEstimado !== null ? exportableEstimado.toFixed(2) : "—"}
          </td>
          <td className="px-2 py-1.5 text-right">
            {puedeCargar && (
              <div className="flex flex-col items-end gap-0.5">
                <button
                  type="button"
                  onClick={confirmar}
                  disabled={confirmando || !valido}
                  className="text-white bg-brand-green hover:bg-brand-green-dark rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
                >
                  {confirmando ? "Cargando…" : "Confirmar"}
                </button>
                {error && (
                  <span className="text-[10px] text-red-600 max-w-[110px]">{error}</span>
                )}
              </div>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

// Bolsas de un lote procesado: de 25 kg, de 50 kg y big bags.
function CeldaBolsas({ lote, puedeEditar }: { lote: LoteDetalle; puedeEditar: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState({
    bolsas_25: lote.bolsas_25 != null ? String(lote.bolsas_25) : "",
    bolsas_50: lote.bolsas_50 != null ? String(lote.bolsas_50) : "",
    big_bags: lote.big_bags != null ? String(lote.big_bags) : "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partes = [
    lote.bolsas_25 ? `${lote.bolsas_25.toLocaleString("es-AR")} × 25 kg` : null,
    lote.bolsas_50 ? `${lote.bolsas_50.toLocaleString("es-AR")} × 50 kg` : null,
    lote.big_bags ? `${lote.big_bags.toLocaleString("es-AR")} big bag${lote.big_bags === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  async function guardar() {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const datos = { bolsas_25: num(valores.bolsas_25), bolsas_50: num(valores.bolsas_50), big_bags: num(valores.big_bags) };
    setGuardando(true);
    setError(null);
    const r = await guardarBolsas(lote.lote_id, datos);
    setGuardando(false);
    if (r.ok) {
      setEditando(false);
      router.refresh();
    } else setError(r.error);
  }

  if (!editando) {
    return (
      <div className="flex items-center gap-2">
        <span className={partes.length ? "" : "text-gray-400"}>{partes.length ? partes.join(" · ") : "Sin cargar"}</span>
        {puedeEditar && (
          <button type="button" onClick={() => setEditando(true)} className="text-brand-green hover:underline text-[11px]">
            {partes.length ? "Editar" : "Cargar"}
          </button>
        )}
      </div>
    );
  }

  const campo = (k: keyof typeof valores, etiqueta: string) => (
    <label className="flex items-center gap-1 whitespace-nowrap">
      <input
        type="number"
        min="0"
        step="1"
        value={valores[k]}
        onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))}
        className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs"
        placeholder="—"
      />
      <span className="text-gray-500">{etiqueta}</span>
    </label>
  );

  return (
    <div className="flex flex-col gap-1">
      {campo("bolsas_25", "× 25 kg")}
      {campo("bolsas_50", "× 50 kg")}
      {campo("big_bags", "big bags")}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="text-white bg-brand-green hover:bg-brand-green-dark rounded px-2 py-0.5 text-[11px] disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={() => setEditando(false)} className="text-gray-500 hover:underline text-[11px]">
          Cancelar
        </button>
      </div>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
