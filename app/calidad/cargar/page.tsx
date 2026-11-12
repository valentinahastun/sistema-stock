import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import CalidadForm, { type LoteCv } from "@/components/CalidadForm";

export default async function CargarCalidadPage() {
  const perfil = await getPerfilActual();
  const supabase = createClient();

  const puedeCargar = perfil?.rol === "admin" || perfil?.rol === "calidad";

  if (!puedeCargar) {
    return (
      <p className="text-gray-600">
        Tu usuario no tiene permiso para cargar registros de calidad.
      </p>
    );
  }

  const [{ data: plantas }, { data: productos }, { data: productores }, { data: lotesConCv }, { data: conStock }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("productores").select("id, nombre").order("nombre"),
      supabase.from("lotes").select("id, cv, planta_id, producto_id, productor_id").not("cv", "is", null),
      supabase.from("stock_lotes").select("lote_id").gt("stock_actual_tn", 0.0005),
    ]);
  // Lotes con CV que todavía tienen stock (para completar la planta al poner el CV)
  const vivos = new Set((conStock ?? []).map((s: any) => s.lote_id as string));
  const lotesCv: LoteCv[] = (lotesConCv ?? [])
    .filter((l: any) => vivos.has(l.id))
    .map((l: any) => ({ cv: l.cv, planta_id: l.planta_id, producto_id: l.producto_id, productor_id: l.productor_id }));

  return (
    <div className="max-w-2xl">
      <Link href="/calidad" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Ver registros de calidad
      </Link>

      <h1 className="text-xl font-semibold mt-2 mb-4 text-brand-navy">Cargar calidad</h1>

      <CalidadForm
        plantas={plantas ?? []}
        productos={productos ?? []}
        productores={productores ?? []}
        lotesCv={lotesCv}
      />
    </div>
  );
}
