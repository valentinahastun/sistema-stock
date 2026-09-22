import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import BotonEliminarMovimiento from "@/components/BotonEliminarMovimiento";

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

export default async function EgresosPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const esAdmin = perfil?.rol === "admin";

  const [{ data: plantas }, { data: productos }, { data: movimientos }] = await Promise.all([
    supabase.from("plantas").select("id, nombre").order("nombre"),
    supabase.from("productos").select("id, nombre").order("nombre"),
    supabase
      .from("movimientos_stock")
      .select(
        "id, cantidad, fecha, motivo, observaciones, numero_cp, transportista, chofer, patente, destino, planta_id, producto_id, productor_id, plantas(nombre), productos(nombre), productores(nombre), lotes!lote_id(planta_id, producto_id, plantas(nombre), productos(nombre))"
      )
      .eq("tipo", "egreso")
      .order("fecha", { ascending: false })
      .limit(300),
  ]);

  type Fila = {
    id: string;
    cantidad: number;
    fecha: string;
    motivo: string | null;
    observaciones: string | null;
    numero_cp: string | null;
    transportista: string | null;
    chofer: string | null;
    patente: string | null;
    destino: string | null;
    planta_id: string | null;
    producto_id: string | null;
    productor_id: string | null;
    plantas: Rel;
    productos: Rel;
    productores: Rel;
    lotes: {
      planta_id: string;
      producto_id: string;
      plantas: Rel;
      productos: Rel;
    } | null;
  };

  // Egresos "generales" (nuevos, sin lote): planta/producto quedan en las
  // columnas propias del movimiento. Egresos viejos (de un lote puntual):
  // planta/producto salen del lote.
  function datosFila(f: Fila) {
    if (f.lotes) {
      return {
        planta: nombreDe(f.lotes.plantas),
        producto: nombreDe(f.lotes.productos),
        productor: "—",
        planta_id: f.lotes.planta_id,
        producto_id: f.lotes.producto_id,
      };
    }
    return {
      planta: nombreDe(f.plantas) || "—",
      producto: nombreDe(f.productos) || "—",
      productor: nombreDe(f.productores) || "—",
      planta_id: f.planta_id,
      producto_id: f.producto_id,
    };
  }

  let filas = (movimientos ?? []) as unknown as Fila[];

  if (searchParams.planta_id) {
    filas = filas.filter((f) => datosFila(f).planta_id === searchParams.planta_id);
  }
  if (searchParams.producto_id) {
    filas = filas.filter((f) => datosFila(f).producto_id === searchParams.producto_id);
  }

  const totalTn = filas.reduce((acc, f) => acc + Number(f.cantidad), 0);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-4">
        Egresos
      </h1>

      <FiltroStock
        plantas={plantas ?? []}
        productos={productos ?? []}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/egresos"
      />

      <div className="bg-white rounded-lg shadow mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Planta (origen)</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Productor</th>
              <th className="px-4 py-2">CP / Transporte</th>
              <th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2 text-right">Cantidad (tn)</th>
              <th className="px-4 py-2">Motivo</th>
              <th className="px-4 py-2">Observaciones</th>
              {esAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const d = datosFila(f);
              return (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{f.fecha}</td>
                  <td className="px-4 py-2">{d.planta}</td>
                  <td className="px-4 py-2">{d.producto}</td>
                  <td className="px-4 py-2">{d.productor}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {f.numero_cp && <div>CP {f.numero_cp}</div>}
                    {(f.transportista || f.chofer || f.patente) && (
                      <div className="text-gray-400">
                        {[f.transportista, f.chofer, f.patente].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {!f.numero_cp && !f.transportista && !f.chofer && !f.patente && "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{f.destino ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {Number(f.cantidad).toFixed(2)}
                  </td>
                  <td className="px-4 py-2">{f.motivo ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{f.observaciones ?? "—"}</td>
                  {esAdmin && (
                    <td className="px-4 py-2">
                      <BotonEliminarMovimiento movimientoId={f.id} />
                    </td>
                  )}
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 10 : 9} className="px-4 py-6 text-center text-gray-400">
                  No hay egresos cargados todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Total egresado: {totalTn.toFixed(2)} tn ({filas.length} movimiento
        {filas.length === 1 ? "" : "s"})
      </p>
      <p className="text-xs text-gray-400 mt-1">
        El destino / motivo y las observaciones son el texto que se escribió al cargar el egreso.
      </p>
    </div>
  );
}
