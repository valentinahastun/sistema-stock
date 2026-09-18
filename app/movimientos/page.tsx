import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
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

  const [{ data: plantas }, { data: productos }, { data: productores }, { data: lotes }, { data: descartes }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("productores").select("id, nombre").order("nombre"),
      supabase
        .from("lotes")
        .select(
          "id, numero_cp, estado, fecha_ingreso, plantas(nombre), productos(nombre), productores(nombre)"
        )
        .order("fecha_ingreso", { ascending: false })
        .limit(200),
      supabase
        .from("movimientos_stock")
        .select(
          "id, cantidad, fecha, motivo, observaciones, lotes!lote_id(numero_cp, plantas(nombre), productos(nombre))"
        )
        .eq("tipo", "descarte")
        .order("fecha", { ascending: false })
        .limit(100),
    ]);

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
        lotes={lotes ?? []}
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


