import Link from "next/link";
import Etapas from "@/components/Etapas";
import { type Alerta, type Operacion, type EstadoEtapa, fecha, nombreOperacion, NOMBRE_RESPONSABLE } from "@/lib/pasos";

type E = { codigo: string; nombre: string; icono: string; estado: EstadoEtapa; total: number; listos: number };

export default function TarjetaOperacion({ o, et, ahora, al }: { o: Operacion; et: E[]; ahora: string; al: Alerta[] }) {
  const vencidas = al.filter((a) => a.nivel === "vencida");
  const proximas = al.filter((a) => a.nivel === "proxima");
  const estado = vencidas.length
    ? { punto: "bg-rose-400", caja: "bg-rose-50 text-rose-700", icono: "⚠️", texto: vencidas[0].mensaje }
    : proximas.length
    ? { punto: "bg-amber-400", caja: "bg-amber-50 text-amber-800", icono: "⏰", texto: proximas[0].mensaje }
    : { punto: "bg-emerald-400", caja: "bg-slate-50 text-slate-600", icono: "👉", texto: ahora };
  return (
    <Link
      href={`/operaciones/${encodeURIComponent(o.clave)}`}
      className="group flex flex-col h-full bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-4 hover:shadow-md hover:ring-slate-200 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={"w-2 h-2 rounded-full " + estado.punto} aria-hidden="true" />
            <span className="font-semibold text-slate-800 group-hover:text-sky-800">{nombreOperacion(o)}</span>
          </div>
          <div className="text-sm text-slate-600 truncate mt-0.5" title={o.cliente ?? ""}>
            {o.cliente ?? "Cliente sin cargar"}
          </div>
        </div>
        {o.responsable && (
          <span
            className={
              "w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 " +
              (o.responsable === "lourdes" ? "bg-violet-50 text-violet-600" : "bg-teal-50 text-teal-700")
            }
            title={NOMBRE_RESPONSABLE[o.responsable]}
          >
            {NOMBRE_RESPONSABLE[o.responsable][0]}
          </span>
        )}
      </div>

      <div className="text-xs text-slate-400 mt-1 truncate">
        {[o.producto, o.tn ? `${Number(o.tn)} tn` : null].filter(Boolean).join(" · ") || "—"}
        {o.destino ? ` · 📍 ${o.destino}` : ""}
      </div>

      <div className="mt-3">
        <Etapas etapas={et} chica alerta={vencidas.length > 0} />
      </div>

      <div className={"mt-3 mb-1 rounded-lg px-3 py-2 text-sm flex gap-2 " + estado.caja}>
        <span aria-hidden="true">{estado.icono}</span>
        <span>{estado.texto}</span>
      </div>

      <div className="flex justify-between text-xs text-slate-400 mt-auto pt-3">
        <span>🛳️ Sale {o.etd ? fecha(o.etd) : "—"}</span>
        <span>Llega {o.eta ? fecha(o.eta) : "—"}</span>
      </div>
    </Link>
  );
}
