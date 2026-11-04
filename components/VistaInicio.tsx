import Link from "next/link";
import { type Alerta, type Operacion, nombreOperacion, NOMBRE_RESPONSABLE } from "@/lib/pasos";

export type Evento = { dia: string; tipo: "carga" | "consolidado" | "corte"; op: Operacion };

// Cómo se agrupan las alertas: una tarjeta por tipo de tarea.
const GRUPOS: { paso: string; titulo: string; icono: string }[] = [
  { paso: "etiqueta", titulo: "Etiquetas por aprobar", icono: "🏷️" },
  { paso: "anticipo", titulo: "Anticipos por cobrar", icono: "💵" },
  { paso: "ip", titulo: "IP por emitir", icono: "📑" },
  { paso: "retiro", titulo: "Calidad sin Apto", icono: "🧪" },
  { paso: "draft_enviado", titulo: "Drafts para mandar al cliente", icono: "📤" },
  { paso: "draft_aprobado", titulo: "Consultar aprobación de drafts", icono: "📄" },
  { paso: "originales", titulo: "Originales pendientes", icono: "📦" },
  { paso: "gmo", titulo: "GMO pendiente", icono: "🧬" },
  { paso: "flete", titulo: "Pago de flete", icono: "🚢" },
  { paso: "cobranza", titulo: "Cobranzas", icono: "💰" },
];

const EVENTO: Record<Evento["tipo"], { texto: string; icono: string; clase: string }> = {
  carga: { texto: "Carga en planta", icono: "🚛", clase: "bg-emerald-50 text-emerald-800" },
  consolidado: { texto: "Consolidado", icono: "📦", clase: "bg-sky-50 text-sky-800" },
  corte: { texto: "Corte documental", icono: "⏰", clase: "bg-amber-50 text-amber-800" },
};

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// "Cobranza pendiente: ETA 15/10" -> "ETA 15/10" (el título de la tarjeta ya dice qué es)
function corto(m: string) {
  const i = m.indexOf(": ");
  return i > 0 && i < 40 ? m.slice(i + 2) : m;
}

export default function VistaInicio({ alertas, eventos, hoy }: { alertas: Alerta[]; eventos: Evento[]; hoy: string }) {
  const vencidas = alertas.filter((a) => a.nivel === "vencida").length;
  const proximas = alertas.length - vencidas;

  const grupos = GRUPOS.map((g) => {
    const items = alertas
      .filter((a) => a.paso === g.paso)
      .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "vencida" ? -1 : 1));
    return { ...g, items, urgentes: items.filter((a) => a.nivel === "vencida").length };
  })
    .filter((g) => g.items.length)
    .sort((a, b) => b.urgentes - a.urgentes || b.items.length - a.items.length);

  // Los 7 días desde hoy
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(hoy + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return {
      iso,
      nombre: i === 0 ? "Hoy" : i === 1 ? "Mañana" : DIAS[d.getUTCDay()],
      num: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
      eventos: eventos.filter((e) => e.dia === iso),
    };
  });

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <Numero n={vencidas} texto="para resolver hoy" clase="text-rose-600" punto="bg-rose-400" />
        <Numero n={proximas} texto="vencen en los próximos días" clase="text-amber-600" punto="bg-amber-400" />
        <Numero n={eventos.length} texto="cargas, consolidados y cortes esta semana" clase="text-sky-700" punto="bg-sky-400" />
      </div>

      {/* Pendientes por tipo */}
      <section>
        <h2 className="text-sm font-medium text-slate-500 mb-2">Pendientes</h2>
        {grupos.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-6 text-center text-slate-500">
            🎉 No hay pendientes. Todo al día.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
            {grupos.map((g) => (
              <div key={g.paso} className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-50">
                  <span className="text-lg" aria-hidden="true">{g.icono}</span>
                  <span className="font-medium text-slate-800 flex-1">{g.titulo}</span>
                  {g.urgentes > 0 && (
                    <span className="text-xs rounded-full bg-rose-50 text-rose-600 px-2 py-0.5">{g.urgentes} hoy</span>
                  )}
                  <span className="text-xs rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">{g.items.length}</span>
                </div>
                <ul>
                  {g.items.map((a, i) => (
                    <li key={a.clave + i} className="flex items-start hover:bg-slate-50">
                      <Link
                        href={`/operaciones/${encodeURIComponent(a.clave)}`}
                        className="flex-1 min-w-0 flex items-start gap-2.5 pl-4 pr-2 py-2"
                      >
                        <span
                          className={"mt-1.5 w-2 h-2 rounded-full shrink-0 " + (a.nivel === "vencida" ? "bg-rose-400" : "bg-amber-400")}
                          aria-hidden="true"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm">
                            <span className="font-medium text-slate-800">{nombreOperacion(a)}</span>
                            <span className="text-slate-500"> · {corto(a.mensaje)}</span>
                          </span>
                          <span className="block text-xs text-slate-400 truncate">
                            {a.cliente ?? ""}
                            {a.destino ? ` · ${a.destino}` : ""}
                          </span>
                        </span>
                        {a.responsable && (
                          <span
                            className={
                              "text-[10px] font-semibold rounded-full w-5 h-5 flex items-center justify-center shrink-0 " +
                              (a.responsable === "lourdes" ? "bg-violet-50 text-violet-600" : "bg-teal-50 text-teal-700")
                            }
                            title={NOMBRE_RESPONSABLE[a.responsable]}
                          >
                            {NOMBRE_RESPONSABLE[a.responsable]?.[0]}
                          </span>
                        )}
                      </Link>
                      {a.mail_url && (
                        <a
                          href={a.mail_url}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir el mail en Gmail"
                          className="shrink-0 mr-3 mt-1.5 text-xs rounded-md px-2 py-1 ring-1 ring-slate-200 text-slate-600 hover:bg-white hover:text-sky-700"
                        >
                          ✉️ Mail
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* La semana */}
      <section>
        <h2 className="text-sm font-medium text-slate-500 mb-2">Esta semana</h2>
        <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm overflow-x-auto">
          <div className="grid grid-cols-7 min-w-[760px] divide-x divide-slate-50">
            {dias.map((d, i) => (
              <div key={d.iso} className={"p-2 min-h-[120px] " + (i === 0 ? "bg-sky-50/40" : "")}>
                <div className="text-center mb-2">
                  <div className={"text-xs " + (i === 0 ? "text-sky-700 font-semibold" : "text-slate-400")}>{d.nombre}</div>
                  <div className={"text-sm " + (i === 0 ? "text-sky-800 font-semibold" : "text-slate-600")}>{d.num}</div>
                </div>
                <div className="space-y-1.5">
                  {d.eventos.map((e, j) => (
                    <Link
                      key={j}
                      href={`/operaciones/${encodeURIComponent(e.op.clave)}`}
                      className={"block rounded-lg px-2 py-1.5 text-xs leading-tight hover:opacity-80 " + EVENTO[e.tipo].clase}
                      title={`${EVENTO[e.tipo].texto} · ${e.op.cliente ?? ""}`}
                    >
                      <span className="font-medium">
                        {EVENTO[e.tipo].icono} {nombreOperacion(e.op)}
                      </span>
                      <span className="block opacity-75">{EVENTO[e.tipo].texto}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Numero({ n, texto, clase, punto }: { n: number; texto: string; clase: string; punto: string }) {
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={"w-2 h-2 rounded-full " + punto} aria-hidden="true" />
        <span className={"text-2xl font-semibold " + clase}>{n}</span>
      </div>
      <div className="text-xs text-slate-500">{texto}</div>
    </div>
  );
}
