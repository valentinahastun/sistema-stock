import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import FilaStock, { type LoteDetalle } from "@/components/FilaStock";

export default async function StockPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const puedeEditar = perfil?.rol === "admin";

  const [{ data: plantas }, { data: productos }, { data: stock }, { data: comprometido }, { data: lotes }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("stock_consolidado").select("*"),
      supabase.from("stock_comprometido").select("*"),
      supabase
        .from("stock_lotes")
        .select(
          "lote_id, planta_id, producto_id, productor, numero_cp, estado, fecha_ingreso, caida_pct_estimada, stock_actual_tn"
        )
        .order("fecha_ingreso", { ascending: false }),
    ]);

  const lotesPorClave = new Map<string, LoteDetalle[]>();
  (lotes ?? []).forEach((l: any) => {
    const clave = `${l.planta_id}-${l.producto_id}`;
    const lista = lotesPorClave.get(clave) ?? [];
    lista.push({
      lote_id: l.lote_id,
      productor: l.productor,
      numero_cp: l.numero_cp,
      estado: l.estado,
      fecha_ingreso: l.fecha_ingreso,
      stock_actual_tn: Number(l.stock_actual_tn),
      caida_pct_estimada: l.caida_pct_estimada === null ? null : Number(l.caida_pct_estimada),
    });
    lotesPorClave.set(clave, lista);
  });

  const comprometidoPorClave = new Map<string, number>();
  (comprometido ?? []).forEach((c) => {
    comprometidoPorClave.set(
      `${c.planta_id}-${c.producto_id}`,
      Number(c.toneladas_comprometidas)
    );
  });

  let filas = (stock ?? []).map((s) => {
    const clave = `${s.planta_id}-${s.producto_id}`;
    const comprometidoTn = comprometidoPorClave.get(clave) ?? 0;
    return {
      ...s,
      stock_disponible_tn: Number(s.stock_disponible_tn),
      comprometido_tn: comprometidoTn,
      libre_tn: Number(s.stock_disponible_tn) - comprometidoTn,
    };
  });

  if (searchParams.planta_id) {
    filas = filas.filter((f) => f.planta_id === searchParams.planta_id);
  }
  if (searchParams.producto_id) {
    filas = filas.filter((f) => f.producto_id === searchParams.producto_id);
  }

  const totalDisponible = filas.reduce((acc, f) => acc + f.stock_disponible_tn, 0);

  const paramsExport = new URLSearchParams();
  if (searchParams.planta_id) paramsExport.set("planta_id", searchParams.planta_id);
  if (searchParams.producto_id) paramsExport.set("producto_id", searchParams.producto_id);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <div className="flex items-center justify-between mb-4 mt-2">
        <h1 className="text-xl font-semibold text-brand-navy">Stock consolidado</h1>
        <a
          href={`/api/export?${paramsExport.toString()}`}
          className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5"
        >
          Exportar a Excel
        </a>
      </div>

      <FiltroStock
        plantas={plantas ?? []}
        productos={productos ?? []}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/stock"
      />

      <div className="bg-white rounded-lg shadow mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Planta</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2 text-right">Disponible (tn)</th>
              <th className="px-4 py-2 text-right">Comprometido (tn)</th>
              <th className="px-4 py-2 text-right">Libre (tn)</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <FilaStock
                key={`${f.planta_id}-${f.producto_id}`}
                planta={f.planta}
                producto={f.producto}
                stockDisponibleTn={f.stock_disponible_tn}
                comprometidoTn={f.comprometido_tn}
                libreTn={f.libre_tn}
                lotes={lotesPorClave.get(`${f.planta_id}-${f.producto_id}`) ?? []}
                puedeEditar={puedeEditar}
              />
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No hay stock cargado todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Total disponible: {totalDisponible.toFixed(2)} tn
      </p>
      <p className="text-xs text-gray-400 mt-1">
        Hacé clic en el nombre de la planta para ver el detalle por lote. En
        los lotes "natural" podés poner el % de caída y confirmarlo: eso
        carga el descarte real sobre ese lote (que pasa a "procesado") y da
        de alta, como stock propio, el ingreso del producto de descarte
        correspondiente (por ejemplo Descarte Negro). Si te equivocaste de
        %, podés borrar ese descarte desde Movimientos y el lote vuelve a
        quedar "natural" para volver a intentarlo.
      </p>
    </div>
  );
}
