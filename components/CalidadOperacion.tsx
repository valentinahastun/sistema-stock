import { PARAMETROS_CALADA, promedioCaladas, type CalidadCv, type CalidadOperacion } from "@/lib/calidadOperaciones";

const dm = (f: string | null) => (f ?? "").split("-").reverse().slice(0, 2).join("/");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`);

// Chip para la lista de operaciones: estado del último análisis de calidad del CV
// (o cuántos camiones van calados, si todavía no hay análisis)
export function ChipCalidad({ analisis, caladas = 0 }: { analisis?: CalidadCv[]; caladas?: number }) {
  if (!analisis?.length) {
    return caladas > 0 ? (
      <span className="text-[10px] font-semibold rounded-full px-1.5 py-px bg-sky-50 text-sky-700" title="Camiones con calada cargada">
        🧪 {caladas} calad{caladas === 1 ? "a" : "as"}
      </span>
    ) : null;
  }
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

// Recuadro para el detalle de la operación: análisis + caladas de la carga
export function RecuadroCalidad({ calidad }: { calidad?: CalidadOperacion }) {
  const analisis = calidad?.analisis ?? [];
  const caladas = calidad?.caladas ?? [];
  const prom = promedioCaladas(caladas);
  const visibles = PARAMETROS_CALADA.filter(([k]) => prom[k]);
  return (
    <div className="mt-4 pt-4 border-t text-sm space-y-3">
      <div>
        <div className="text-xs text-gray-500 mb-1">Calidad</div>
        {!analisis.length ? (
          <p className="text-gray-400">
            {caladas.length
              ? "Todavía no hay análisis final; abajo están las caladas de la carga."
              : "Todavía no hay análisis cargado con este CV. Se carga en Calidad → Cargar, poniendo el CV."}
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

      {caladas.length > 0 && (
        <div className="rounded-lg bg-sky-50/60 ring-1 ring-sky-100 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="text-xs font-semibold text-sky-800">
              Calidad de la carga · promedio de {caladas.length} {caladas.length === 1 ? "camión" : "camiones"}
            </div>
            <div className="text-[11px] text-sky-700">última calada {caladas[0].hora ?? dm(caladas[0].fecha)}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {prom.danos_totales && <Cuadro t="Daños totales" v={pct(prom.danos_totales.valor)} fuerte />}
            {visibles.map(([k, nombre]) => (
              <Cuadro key={k} t={nombre} v={pct(prom[k]!.valor)} nota={prom[k]!.n < caladas.length ? `${prom[k]!.n} de ${caladas.length}` : undefined} />
            ))}
          </div>
          <details className="mt-2">
            <summary className="text-xs text-sky-800 cursor-pointer">Ver cada camión</summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-3">Hora</th>
                    <th className="py-1 pr-3">CP</th>
                    <th className="py-1 pr-3">Patente</th>
                    <th className="py-1 pr-3 text-right">Daños</th>
                    {visibles.map(([k, nombre]) => (
                      <th key={k} className="py-1 pr-3 text-right whitespace-nowrap">{nombre}</th>
                    ))}
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {caladas.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1 pr-3 whitespace-nowrap">{dm(c.fecha)} {c.hora ?? ""}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{c.numero_cp}</td>
                      <td className="py-1 pr-3">{c.patente ?? "—"}</td>
                      <td className="py-1 pr-3 text-right">{pct(c.valores.danos_totales)}</td>
                      {visibles.map(([k]) => (
                        <td key={k} className="py-1 pr-3 text-right">{pct(c.valores[k])}</td>
                      ))}
                      <td className="py-1">
                        <a href={`/api/calidad/${c.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-brand-navy underline">PDF</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function Cuadro({ t, v, nota, fuerte }: { t: string; v: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className={`rounded bg-white px-2 py-1.5 ${fuerte ? "ring-1 ring-sky-300" : ""}`}>
      <div className="text-[10px] text-gray-500">{t}</div>
      <div className={`${fuerte ? "font-semibold text-sky-900" : "font-medium text-gray-800"}`}>{v}</div>
      {nota && <div className="text-[10px] text-gray-400">{nota}</div>}
    </div>
  );
}
