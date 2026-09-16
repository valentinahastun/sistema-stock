import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import MovimientoForm from "@/components/MovimientoForm";

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

  const [{ data: plantas }, { data: productos }, { data: productores }, { data: lotes }] =
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
    ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-4 text-brand-navy">Cargar movimiento</h1>
      <MovimientoForm
        plantas={plantas ?? []}
        productos={productos ?? []}
        productores={productores ?? []}
        lotes={lotes ?? []}
      />
    </div>
  );
}
