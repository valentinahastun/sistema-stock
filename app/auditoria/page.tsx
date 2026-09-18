import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";

const NOMBRE_TABLA: Record<string, string> = {
  movimientos_stock: "Movimiento de stock",
  lotes: "Lote",
  registros_calidad: "Registro de calidad",
};

type FilaLog = {
  id: string;
  tabla: string;
  registro_id: string;
  datos: Record<string, unknown>;
  eliminado_por_nombre: string | null;
  fecha: string;
};

export default async function AuditoriaPage() {
  const perfil = await getPerfilActual();

  if (!perfil || perfil.rol !== "admin") {
    return (
      <p className="text-gray-600">
        Esta sección es solo para el usuario administrador.
      </p>
    );
  }

  const supabase = createClient();
  const { data: log } = await supabase
    .from("log_eliminaciones")
    .select("id, tabla, registro_id, datos, eliminado_por_nombre, fecha")
    .order("fecha", { ascending: false })
    .limit(200);

  const filas = (log ?? []) as FilaLog[];

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-1">
        Auditoría de eliminaciones
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Todo lo que se borró en el sistema (movimientos, lotes o registros de
        calidad), con quién y cuándo. No se puede deshacer un borrado desde
        aquí, pero queda el detalle completo del registro para reconstruirlo
        a mano si hace falta.
      </p>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Usuario</th>
              <th className="px-4 py-2">Qué se borró</th>
              <th className="px-4 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b last:border-0 align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(f.fecha).toLocaleString("es-AR")}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {f.eliminado_por_nombre ?? "—"}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {NOMBRE_TABLA[f.tabla] ?? f.tabla}
                </td>
                <td className="px-4 py-2">
                  <details>
                    <summary className="cursor-pointer text-brand-navy hover:underline">
                      Ver datos
                    </summary>
                    <pre className="text-xs bg-gray-50 rounded p-2 mt-1 whitespace-pre-wrap break-all">
                      {JSON.stringify(f.datos, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No hay eliminaciones registradas todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
