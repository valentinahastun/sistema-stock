import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import BotonEliminarMovimiento from "@/components/BotonEliminarMovimiento";

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

// Movimientos "directos": compra y venta que nunca pasa por el depósito
// propio. No suman ni restan stock de ninguna planta (por eso no
// aparecen en /stock, /ingresos ni /egresos); son solo un registro con
// trazabilidad de por dónde pasó la mercadería, según la CP.
export default async function DirectosPage() {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const esAdmin = perfil?.rol === "admin";

  const { data: movimientos } = await supabase
    .from("movimientos_stock")
    .select(
      "id, cantidad, fecha, observaciones, numero_cp, transportista, chofer, patente, titular, productor_texto, destino, productos(nombre)"
    )
    .eq("tipo", "directo")
    .order("fecha", { ascending: false })
    .limit(300);

  type Fila = {
    id: string;
    cantidad: number;
    fecha: string;
    observaciones: string | null;
    numero_cp: string | null;
    transportista: string | null;
    chofer: string | null;
    patente: string | null;
    titular: string | null;
    productor_texto: string | null;
    destino: string | null;
    productos: Rel;
  };

  const filas = (movimientos ?? []) as unknown as Fila[];
  const totalTn = filas.reduce((acc, f) => acc + Number(f.cantidad), 0);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-1">
        Movimientos directos
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Compra y venta que no pasa por el depósito: no suman ni restan stock,
        quedan solo como registro de trazabilidad.
      </p>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">CP / Transporte</th>
              <th className="px-4 py-2">Titular</th>
              <th className="px-4 py-2">Productor / remitente</th>
              <th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2 text-right">Cantidad (tn)</th>
              <th className="px-4 py-2">Observaciones</th>
              {esAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">{f.fecha}</td>
                <td className="px-4 py-2">{nombreDe(f.productos) || "—"}</td>
                <td className="px-4 py-2 text-xs text-gray-600">
                  {f.numero_cp && <div>CP {f.numero_cp}</div>}
                  {(f.transportista || f.chofer || f.patente) && (
                    <div className="text-gray-400">
                      {[f.transportista, f.chofer, f.patente].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {!f.numero_cp && !f.transportista && !f.chofer && !f.patente && "—"}
                </td>
                <td className="px-4 py-2 text-gray-600">{f.titular ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600">{f.productor_texto ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600">{f.destino ?? "—"}</td>
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
                <td colSpan={esAdmin ? 9 : 8} className="px-4 py-6 text-center text-gray-400">
                  No hay movimientos directos cargados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 mt-3">
        Total: {totalTn.toFixed(2)} tn ({filas.length} movimiento
        {filas.length === 1 ? "" : "s"})
      </p>
    </div>
  );
}
