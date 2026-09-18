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

export default async function IngresosPage({
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
        "id, cantidad, fecha, observaciones, lotes(numero_cp, estado, planta_id, producto_id, plantas(nombre), productos(nombre), productores(nombre))"
      )
      .eq("tipo", "ingreso")
      .order("fecha", { ascending: false })
      .limit(300),
  ]);

  type Fila = {
    id: string;
    cantidad: number;
    fecha: string;
    observaciones: string | null;
    lotes: {
      numero_cp: string | null;
      estado: string;
      planta_id: string;
      producto_id: string;
      plantas: Rel;
      productos: Rel;
      productores: Rel;
    } | null;
  };

  let filas = ((movimientos ?? []) as unknown as Fila[]).filter((f) => f.lotes);

  if (searchParams.planta_id) {
    filas = filas.filter((f) => f.lotes?.planta_id === searchParams.planta_id);
  }
  if (searchParams.producto_id) {
    filas = filas.filter((f) => f.lotes?.producto_id === searchParams.producto_id);
  }

  const totalTn = filas.reduce((acc, f) => acc + Number(f.cantidad), 0);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-4">
        Ingresos
      </h1>

      <FiltroStock
        plantas={plantas ?? []}
        productos={productos ?? []}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/ingresos"
      />

      <div className="bg-white rounded-lg shadow mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Planta</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Productor</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2 text-right">Cantidad (tn)</th>
              <th className="px-4 py-2">Observaciones</th>
              {esAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{f.fecha}</td>
                <td className="px-4 py-2">{nombreDe(f.lotes?.plantas ?? null)}</td>
                <td className="px-4 py-2">{nombreDe(f.lotes?.productos ?? null)}</td>
                <td className="px-4 py-2">{nombreDe(f.lotes?.productores ?? null)}</td>
                <td className="px-4 py-2 capitalize">{f.lotes?.estado}</td>
                <td className="px-4 py-2 text-right font-medium">
                  {Number(f.cantidad).toFixed(2)}
                </td>
                <td className="px-4 py-2 text-gray-500">{f.observaciones ?? "—"}</td>
                {esAdmin && (
                  <td className="px-4 py-2">
                    <BotonEliminarMovimiento movimientoId={f.id} />
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 8 : 7} className="px-4 py-6 text-center text-gray-400">
                  No hay ingresos cargados todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Total ingresado: {totalTn.toFixed(2)} tn ({filas.length} movimiento
        {filas.length === 1 ? "" : "s"})
      </p>
    </div>
  );
}
