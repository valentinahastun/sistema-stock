import type { EstadoEtapa } from "@/lib/pasos";

type E = { codigo: string; nombre: string; icono: string; estado: EstadoEtapa; total: number; listos: number };

// Avance por etapas. "chica" para las tarjetas, normal para el detalle.
export default function Etapas({ etapas, chica, alerta }: { etapas: E[]; chica?: boolean; alerta?: boolean }) {
  const actual = etapas.find((e) => e.estado === "actual");

  if (chica) {
    return (
      <div>
        <div className="flex gap-1" aria-label="Avance por etapa">
          {etapas.map((e) => (
            <div
              key={e.codigo}
              title={e.nombre}
              className={
                "h-1.5 flex-1 rounded-full " +
                (e.estado === "hecha"
                  ? "bg-emerald-300"
                  : e.estado === "actual"
                  ? alerta ? "bg-rose-300" : "bg-sky-400"
                  : "bg-slate-100")
              }
            />
          ))}
        </div>
        <div className="mt-1.5 text-[11px] text-slate-400">
          {actual ? `Etapa ${etapas.indexOf(actual) + 1} de ${etapas.length} · ${actual.nombre}` : "Todas las etapas listas"}
        </div>
      </div>
    );
  }

  return (
    <ol className="flex items-start">
      {etapas.map((e, i) => (
        <li key={e.codigo} className="flex-1 flex flex-col items-center text-center relative">
          {i > 0 && (
            <span
              className={
                "absolute top-5 right-1/2 w-full h-0.5 -z-0 " +
                (e.estado === "pendiente" ? "bg-slate-100" : "bg-emerald-200")
              }
              aria-hidden="true"
            />
          )}
          <span
            className={
              "relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-lg " +
              (e.estado === "hecha"
                ? "bg-emerald-50 ring-2 ring-emerald-300"
                : e.estado === "actual"
                ? alerta ? "bg-rose-50 ring-2 ring-rose-300" : "bg-sky-50 ring-2 ring-sky-400"
                : "bg-slate-50 ring-1 ring-slate-200 grayscale opacity-60")
            }
            aria-hidden="true"
          >
            {e.estado === "hecha" ? <span className="text-emerald-600 text-base font-semibold">✓</span> : e.icono}
          </span>
          <span className={"mt-2 text-xs leading-tight px-1 " + (e.estado === "pendiente" ? "text-slate-400" : "text-slate-700 font-medium")}>
            {e.nombre}
          </span>
          <span className="text-[11px] text-slate-400">
            {e.estado === "hecha" ? "Listo" : e.estado === "actual" ? (alerta ? "Atrasado" : "En curso") : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
