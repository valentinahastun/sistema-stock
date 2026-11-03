import type { EstadoEtapa } from "@/lib/pasos";

type E = { codigo: string; nombre: string; icono: string; estado: EstadoEtapa; total: number; listos: number };

// Barra de 6 etapas. "chica" para las tarjetas, normal para el detalle.
export default function Etapas({ etapas, chica, alerta }: { etapas: E[]; chica?: boolean; alerta?: boolean }) {
  if (chica) {
    return (
      <div className="flex gap-1" aria-label="Avance por etapa">
        {etapas.map((e) => (
          <div key={e.codigo} className="flex-1" title={e.nombre}>
            <div
              className={
                "h-2 rounded-full " +
                (e.estado === "hecha"
                  ? "bg-brand-green"
                  : e.estado === "actual"
                  ? alerta ? "bg-red-400" : "bg-brand-navy"
                  : "bg-gray-200")
              }
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {etapas.map((e) => (
        <li
          key={e.codigo}
          className={
            "rounded-lg border p-3 text-center " +
            (e.estado === "hecha"
              ? "bg-brand-green-light border-brand-green"
              : e.estado === "actual"
              ? alerta ? "bg-red-50 border-red-300" : "bg-white border-brand-navy border-2"
              : "bg-gray-50 border-gray-200 opacity-60")
          }
        >
          <div className="text-2xl" aria-hidden="true">{e.icono}</div>
          <div className="text-xs font-medium mt-1">{e.nombre}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {e.estado === "hecha" ? "✓ Listo" : e.estado === "actual" ? (alerta ? "⚠ Atrasado" : "En curso") : "Más adelante"}
          </div>
        </li>
      ))}
    </ol>
  );
}
