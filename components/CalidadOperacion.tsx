import type { CalidadCv } from "@/lib/calidadOperaciones";

const dm = (f: string | null) => (f ?? "").split("-").reverse().slice(0, 2).join("/");

// Chip para la lista de operaciones: estado del último análisis de calidad del CV
export function ChipCalidad({ analisis }: { analisis?: CalidadCv[] }) {
  if (!analisis?.length) return null;
  const a = analisis[0];
  const [texto, clase] =
    a.apto === true
      ? ["✓ Apto", "bg-emerald-50 text-emerald-700"]
      : a.apto === false
      ? ["✗ No apto", "bg-rose-50 text-rose-700"]
      : ["Calidad sin definir", "bg-slate-100 text-slate-500"];
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-px ${clase}`} title={`Análisis del ${dm(a.fecha)}`}>
      {texto}
    </span>
  );
}

// Recuadro para el detalle de la operación
export function RecuadroCalidad({ analisis }: { analisis?: CalidadCv[] }) {
  return (
    <div className="mt-4 pt-4 border-t text-sm">
      <div className="text-xs text-gray-500 mb-1">Calidad</div>
      {!analisis?.length ? (
        <p className="text-gray-400">
          Todavía no hay análisis cargado con este CV. Se carga en Calidad → Cargar, poniendo el CV.
        </p>
      ) : (
        <ul className="space-y-1">
          {analisis.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <ChipCalidad analisis={[a]} />
              <a href={`/api/calidad/${a.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-brand-navy underline">
                📄 Análisis del {dm(a.fecha)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
