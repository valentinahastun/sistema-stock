"use client";

import { useRouter } from "next/navigation";

type Catalogo = { id: string; nombre: string };

export default function FiltroStock({
  plantas,
  productos,
  productores,
  plantaSeleccionada,
  productoSeleccionado,
  productorSeleccionado = "",
  basePath = "/stock",
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  productores?: Catalogo[];
  plantaSeleccionada: string;
  productoSeleccionado: string;
  productorSeleccionado?: string;
  basePath?: string;
}) {
  const router = useRouter();

  function actualizar(planta_id: string, producto_id: string, productor_id: string) {
    const params = new URLSearchParams();
    if (planta_id) params.set("planta_id", planta_id);
    if (producto_id) params.set("producto_id", producto_id);
    if (productor_id) params.set("productor_id", productor_id);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex gap-3">
      <select
        className="border rounded px-3 py-1.5 text-sm bg-white"
        value={plantaSeleccionada}
        onChange={(e) => actualizar(e.target.value, productoSeleccionado, productorSeleccionado)}
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
        onChange={(e) => actualizar(plantaSeleccionada, e.target.value, productorSeleccionado)}
      >
        <option value="">Todos los productos</option>
        {productos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>

      {productores && (
        <select
          className="border rounded px-3 py-1.5 text-sm bg-white"
          value={productorSeleccionado}
          onChange={(e) => actualizar(plantaSeleccionada, productoSeleccionado, e.target.value)}
        >
          <option value="">Todos los productores</option>
          {productores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

