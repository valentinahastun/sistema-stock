import Link from "next/link";
import type { CalidadOperacion } from "@/lib/calidadOperaciones";
import { ChipCalidad } from "@/components/CalidadOperacion";
import { type Alerta, type Operacion, type EstadoEtapa, ETAPAS, fecha, nombreOperacion, NOMBRE_RESPONSABLE } from "@/lib/pasos";

type E = { codigo: string; nombre: string; icono: string; estado: EstadoEtapa; total: number; listos: number };
export type FilaOperacion = { o: Operacion; et: E[]; ahora: string; al: Alerta[]; calidad?: CalidadOperacion };

// Nombres cortos para el encabezado de la tabla
const CORTO: Record<string, string> = {
  contrato: "Contrato",
  reserva: "Booking",
  carga: "Carga",
  documentos: "Drafts",
  originales: "Originales",
  cobro: "Cobro",
};

// Una fila por operación, una columna por etapa: se lee de un vistazo
// en qué etapa está cada una y qué falta.
export default function TablaOperaciones({ filas }: { filas: FilaOperacion[] }) {
  if (!filas.length) {
    return <p className="text-slate-400 text-sm text-center py-8">No hay operaciones para este filtro.</p>;
  }
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <th className="text-left font-medium px-4 py-3">Operación</th>
            {ETAPAS.map((e) => (
              <th key={e.codigo} className="font-medium px-1 py-3 w-[84px] min-w-[84px]" title={e.nombre}>
                {CORTO[e.codigo] ?? e.nombre}
              </th>
            ))}
            <th className="text-left font-medium px-4 py-3">Qué falta</th>
            <th className="text-right font-medium px-4 py-3">Llega</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ o, et, ahora, al, calidad }) => {
            const vencida = al.find((a) => a.nivel === "vencida");
            const proxima = al.find((a) => a.nivel === "proxima");
            const href = `/operaciones/${encodeURIComponent(o.clave)}`;
            return (
              <tr key={o.clave} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                <td className="px-4 py-2.5 min-w-[220px]">
                  <Link href={href} className="block">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 hover:text-sky-700">{nombreOperacion(o)}</span>
                      <ChipCalidad analisis={calidad?.analisis} caladas={calidad?.caladas.length} />
                      {o.responsable && (
                        <span
                          className={
                            "text-[10px] font-semibold rounded-full px-1.5 py-px " +
                            (o.responsable === "lourdes" ? "bg-violet-50 text-violet-600" : "bg-teal-50 text-teal-700")
                          }
                          title={NOMBRE_RESPONSABLE[o.responsable]}
                        >
                          {NOMBRE_RESPONSABLE[o.responsable]}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500 truncate max-w-[260px]" title={o.cliente ?? ""}>
                      {o.cliente ?? "Cliente sin cargar"}
                      {o.destino ? ` · ${o.destino}` : ""}
                    </span>
                  </Link>
                </td>

                {et.map((e, i) => (
                  <td key={e.codigo} className="px-0 py-2.5">
                    <div className="relative flex items-center justify-center h-6">
                      {/* línea que une las etapas */}
                      {i > 0 && (
                        <span
                          className={
                            "absolute left-0 right-1/2 h-0.5 " + (e.estado === "pendiente" ? "bg-slate-100" : "bg-emerald-200")
                          }
                        />
                      )}
                      {i < et.length - 1 && (
                        <span
                          className={
                            "absolute left-1/2 right-0 h-0.5 " +
                            (et[i + 1].estado === "pendiente" ? "bg-slate-100" : "bg-emerald-200")
                          }
                        />
                      )}
                      <Punto estado={e.estado} alerta={!!vencida} nombre={e.nombre} />
                    </div>
                  </td>
                ))}

                <td className="px-4 py-2.5 min-w-[220px]">
                  <Link
                    href={href}
                    className={
                      "block leading-snug " +
                      (vencida ? "text-rose-600" : proxima ? "text-amber-700" : "text-slate-600")
                    }
                  >
                    {vencida?.mensaje ?? proxima?.mensaje ?? ahora}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{o.eta ? fecha(o.eta) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Punto({ estado, alerta, nombre }: { estado: EstadoEtapa; alerta: boolean; nombre: string }) {
  if (estado === "hecha") {
    return (
      <span
        className="relative z-10 w-5 h-5 rounded-full bg-emerald-400 text-white text-[11px] flex items-center justify-center"
        title={nombre + ": listo"}
      >
        ✓
      </span>
    );
  }
  if (estado === "actual") {
    return (
      <span
        className={
          "relative z-10 w-5 h-5 rounded-full border-[3px] bg-white " + (alerta ? "border-rose-400" : "border-sky-500")
        }
        title={nombre + (alerta ? ": atrasado" : ": en curso")}
      />
    );
  }
  return <span className="relative z-10 w-2.5 h-2.5 rounded-full bg-slate-200" title={nombre + ": más adelante"} />;
}
