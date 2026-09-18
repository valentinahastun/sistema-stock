import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import AltaCatalogo from "@/components/AltaCatalogo";
import { crearPlanta, crearProducto, crearProductor } from "@/app/catalogos/actions";

export default async function CatalogosPage() {
  const perfil = await getPerfilActual();

  if (!perfil || perfil.rol !== "admin") {
    return (
      <p className="text-gray-600">
        Esta sección es solo para el usuario administrador.
      </p>
    );
  }

  const supabase = createClient();
  const [{ data: plantas }, { data: productos }, { data: productores }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre"),
      supabase.from("productos").select("id, nombre"),
      supabase.from("productores").select("id, nombre"),
    ]);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-1">
        Catálogos
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Alta de plantas, productos y productores nuevos. Se cargan acá y
        quedan disponibles al toque en toda la app (movimientos, calidad,
        stock), sin depender de tocar la base de datos.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AltaCatalogo
          titulo="Plantas"
          placeholder="Nombre de la planta"
          items={plantas ?? []}
          accion={crearPlanta}
        />
        <AltaCatalogo
          titulo="Productos"
          placeholder="Nombre del producto"
          items={productos ?? []}
          accion={crearProducto}
        />
        <AltaCatalogo
          titulo="Productores"
          placeholder="Nombre del productor"
          items={productores ?? []}
          accion={crearProductor}
        />
      </div>
    </div>
  );
}
