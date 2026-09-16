"use client";

import { useRouter } from "next/navigation";

type Catalogo = { id: string; nombre: string };

export default function FiltroStock({
  plantas,
  productos,
  plantaSeleccionada,
  productoSeleccionado,
  basePath = "/stock",
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  plantaSeleccionada: string;
  productoSeleccionado: string;
  basePath?: string;
}) {
  const router = useRouter();

  function actualizar(planta_id: string, producto_id: string) {
    const params = new URLSearchParams();
    if (planta_id) params.set("planta_id", planta_id);
    if (producto_id) params.set("producto_id", producto_id);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex gap-3">
      <select
        className="border rounded px-3 py-1.5 text-sm bg-white"
        value={plantaSeleccionada}
        onChange={(e) => actualizar(e.target.value, productoSeleccionado)}
      >
        <option value="">Todas las plantas</option>
        {plantas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>

      <select
        className="border rounded px-3 py-1.5 text-sm bg-white"
        value={productoSeleccionado}
        onChange={(e) => actualizar(plantaSeleccionada, e.target.value)}
      >
        <option value="">Todos los productos</option>
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}
