import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import CalidadForm from "@/components/CalidadForm";

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

  const [{ data: plantas }, { data: productos }, { data: productores }] = await Promise.all([
    supabase.from("plantas").select("id, nombre").order("nombre"),
    supabase.from("productos").select("id, nombre").order("nombre"),
    supabase.from("productores").select("id, nombre").order("nombre"),
  ]);

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
      />
    </div>
  );
}
