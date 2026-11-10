import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { repartirEgresos } from "@/lib/repartoEgresos";
import MovimientoForm from "@/components/MovimientoForm";
import BotonEliminarMovimiento from "@/components/BotonEliminarMovimiento";

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

export default async function MovimientosPage() {
  const perfil = await getPerfilActual();
  const supabase = createClient();

  if (!perfil || perfil.rol !== "admin") {
    return (
      <p className="text-gray-600">
        Tu usuario es de consulta: podés ver el panel de stock, pero no
        cargar movimientos.
      </p>
    );
  }

  const [
    { data: plantas },
    { data: productos },
    { data: productores },
    { data: descartes },
    { data: stock },
    { data: stockLotes },
    { data: lotesCv },
    { data: egresos },
  ] = await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("productores").select("id, nombre").order("nombre"),
      supabase
        .from("movimientos_stock")
        .select(
          "id, cantidad, fecha, motivo, observaciones, lotes!lote_id(numero_cp, plantas(nombre), productos(nombre))"
        )
        .eq("tipo", "descarte")
        .order("fecha", { ascending: false })
        .limit(100),
      supabase.from("stock_consolidado").select("planta_id, producto_id, stock_disponible_tn"),
      supabase.from("stock_lotes").select("lote_id, planta_id, producto_id, productor, estado, fecha_ingreso, stock_actual_tn").gt("stock_actual_tn", 0.0005),
      supabase.from("lotes").select("id, cv").not("cv", "is", null),
      supabase
        .from("movimientos_stock")
        .select("planta_id, producto_id, cantidad, cv, productores(nombre)")
        .eq("tipo", "egreso")
        .is("lote_id", null),
    ]);

  // Stock de cada lote con su productor y CV, después de repartir las
  // salidas igual que la pantalla de Stock: para sugerir de quién sale un
  // egreso y avisar si el CV no coincide.
  const idProductor = new Map((productores ?? []).map((p) => [p.nombre, p.id]));
  const cvDeLote = new Map((lotesCv ?? []).map((l: any) => [l.id, l.cv as string]));
  const lotesPorClave = new Map<string, any[]>();
  (stockLotes ?? []).forEach((l: any) => {
    const clave = `${l.planta_id}-${l.producto_id}`;
    lotesPorClave.set(clave, [
      ...(lotesPorClave.get(clave) ?? []),
      {
        planta_id: l.planta_id,
        producto_id: l.producto_id,
        productor: l.productor,
        estado: l.estado,
        fecha_ingreso: l.fecha_ingreso,
        stock_actual_tn: Number(l.stock_actual_tn),
        cv: cvDeLote.get(l.lote_id) ?? null,
      },
    ]);
  });
  repartirEgresos(
    lotesPorClave,
    (egresos ?? []).map((e: any) => ({
      planta_id: e.planta_id,
      producto_id: e.producto_id,
      cantidad: Number(e.cantidad),
      cv: e.cv ?? null,
      productor: (Array.isArray(e.productores) ? e.productores[0]?.nombre : e.productores?.nombre) ?? null,
    }))
  );
  const lotesStock = Array.from(lotesPorClave.values())
    .flat()
    .filter((l) => l.stock_actual_tn > 0.0005)
    .map((l) => ({
      planta_id: l.planta_id as string,
      producto_id: l.producto_id as string,
      productor_id: (idProductor.get(l.productor) as string | undefined) ?? null,
      cv: l.cv as string | null,
      tn: l.stock_actual_tn as number,
    }));

  type FilaDescarte = {
    id: string;
    cantidad: number;
    fecha: string;
    motivo: string | null;
    observaciones: string | null;
    lotes: { numero_cp: string | null; plantas: Rel; productos: Rel } | null;
  };
  const filasDescarte = ((descartes ?? []) as unknown as FilaDescarte[]).filter((f) => f.lotes);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-4 text-brand-navy">Cargar movimiento</h1>
      <MovimientoForm
        plantas={plantas ?? []}
        productos={productos ?? []}
        productores={productores ?? []}
        stock={(stock ?? []).map((x: any) => ({
          planta_id: x.planta_id,
          producto_id: x.producto_id,
          tn: Number(x.stock_disponible_tn),
        }))}
        lotesStock={lotesStock}
      />

      <h2 className="text-lg font-semibold mt-8 mb-3 text-brand-navy">
        Descartes cargados
      </h2>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Planta</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">CP</th>
              <th className="px-4 py-2 text-right">Cantidad (tn)</th>
              <th className="px-4 py-2">Motivo</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filasDescarte.map((f) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{f.fecha}</td>
                <td className="px-4 py-2">{nombreDe(f.lotes?.plantas ?? null)}</td>
                <td className="px-4 py-2">{nombreDe(f.lotes?.productos ?? null)}</td>
                <td className="px-4 py-2">{f.lotes?.numero_cp ?? "—"}</td>
                <td className="px-4 py-2 text-right font-medium">
                  {Number(f.cantidad).toFixed(2)}
                </td>
                <td className="px-4 py-2 capitalize">{f.motivo ?? "—"}</td>
                <td className="px-4 py-2">
                  <BotonEliminarMovimiento movimientoId={f.id} />
                </td>
              </tr>
            ))}
            {filasDescarte.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  No hay descartes cargados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

