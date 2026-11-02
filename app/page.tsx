import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import FiltroResponsable from "@/components/FiltroResponsable";
import { type Alerta, type Operacion, fecha, nombreOperacion, NOMBRE_RESPONSABLE } from "@/lib/pasos";

export const dynamic = "force-dynamic";

// Agenda: lo que hay que hacer hoy y lo que viene en los próximos días.
export default async function Agenda({ searchParams }: { searchParams: { resp?: string } }) {
  const u = await getUsuario();
  if (!u) return null;
  if (!u.acceso) return <SinAcceso email={u.email} />;

  const resp = searchParams.resp ?? u.acceso.responsable ?? "todas";
  const supabase = createClient();
  const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const en7 = new Date(Date.now() - 3 * 3600 * 1000 + 7 * 864e5).toISOString().slice(0, 10);

  const [{ data: alertasData, error }, { data: cargasData }] = await Promise.all([
    supabase.rpc("op_alertas"),
    supabase
      .from("op_operaciones")
      .select("*")
      .eq("activa", true)
      .or(
        `and(fecha_carga_planta.gte.${hoy},fecha_carga_planta.lte.${en7}),and(fecha_consolidado.gte.${hoy},fecha_consolidado.lte.${en7}),and(corte_documental.gte.${hoy},corte_documental.lte.${en7})`
      ),
  ]);

  const filtrar = <T extends { responsable: string | null }>(l: T[]) =>
    resp === "todas" ? l : l.filter((x) => x.responsable === resp);

  const alertas = filtrar((alertasData ?? []) as Alerta[]);
  const vencidas = alertas.filter((a) => a.nivel === "vencida");
  const proximas = alertas.filter((a) => a.nivel === "proxima");

  type Evento = { dia: string; tipo: string; op: Operacion };
  const eventos: Evento[] = [];
  filtrar((cargasData ?? []) as Operacion[]).forEach((op) => {
    const dentro = (d: string | null) => d && d >= hoy && d <= en7;
    if (dentro(op.fecha_carga_planta)) eventos.push({ dia: op.fecha_carga_planta!, tipo: "Carga en planta", op });
    if (dentro(op.fecha_consolidado)) eventos.push({ dia: op.fecha_consolidado!, tipo: "Consolidado", op });
    if (dentro(op.corte_documental)) eventos.push({ dia: op.corte_documental!, tipo: "Corte documental", op });
  });
  eventos.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Agenda</h1>
          <p className="text-sm text-gray-500">Hoy {fecha(hoy, true)}</p>
        </div>
        <FiltroResponsable base="/" actual={resp} />
      </div>

      {error && (
        <p className="text-sm text-red-600">No se pudieron calcular las alertas: {error.message}</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Resumen numero={vencidas.length} texto="para resolver hoy" color="text-red-700" />
        <Resumen numero={proximas.length} texto="vencen en los próximos días" color="text-amber-700" />
        <Resumen numero={eventos.length} texto="cargas, consolidados y cortes en 7 días" color="text-brand-navy" />
      </div>

      <ListaAlertas titulo="Para resolver hoy" alertas={vencidas} tono="rojo" />
      <ListaAlertas titulo="Vencen en los próximos días" alertas={proximas} tono="ambar" />

      <section className="bg-white rounded-lg shadow">
        <h2 className="px-4 py-3 border-b font-medium text-brand-navy">Próximos 7 días</h2>
        {eventos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No hay cargas, consolidados ni cortes en los próximos 7 días.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {eventos.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-2 w-20 font-medium">{fecha(e.dia)}</td>
                  <td className="px-4 py-2 w-40">{e.tipo}</td>
                  <td className="px-4 py-2">
                    <Link href={`/operaciones/${encodeURIComponent(e.op.clave)}`} className="text-brand-navy hover:underline">
                      {nombreOperacion(e.op)}
                    </Link>{" "}
                    <span className="text-gray-500">
                      · {e.op.cliente ?? ""} · {e.op.destino ?? ""}
                      {e.tipo === "Carga en planta" && e.op.lugar_carga ? ` · ${e.op.lugar_carga}` : ""}
                      {e.tipo === "Consolidado" && e.op.deposito ? ` · ${e.op.deposito}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-right">
                    {e.op.responsable ? NOMBRE_RESPONSABLE[e.op.responsable] : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Resumen({ numero, texto, color }: { numero: number; texto: string; color: string }) {
  return (
    <div className="bg-white rounded-lg shadow px-4 py-3">
      <div className={`text-2xl font-semibold ${color}`}>{numero}</div>
      <div className="text-xs text-gray-500">{texto}</div>
    </div>
  );
}

function ListaAlertas({ titulo, alertas, tono }: { titulo: string; alertas: Alerta[]; tono: "rojo" | "ambar" }) {
  if (alertas.length === 0) return null;
  const punto = tono === "rojo" ? "bg-red-500" : "bg-amber-400";
  return (
    <section className="bg-white rounded-lg shadow">
      <h2 className="px-4 py-3 border-b font-medium text-brand-navy">
        {titulo} <span className="text-gray-400 font-normal">({alertas.length})</span>
      </h2>
      <ul>
        {alertas.map((a, i) => (
          <li key={i} className="border-b last:border-0">
            <Link
              href={`/operaciones/${encodeURIComponent(a.clave)}`}
              className="flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50"
            >
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${punto}`} />
              <span className="flex-1">
                <span className="text-sm">{a.mensaje}</span>
                <span className="block text-xs text-gray-500">
                  {nombreOperacion(a)} · {a.cliente ?? ""} · {a.destino ?? ""}
                </span>
              </span>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {a.responsable ? NOMBRE_RESPONSABLE[a.responsable] : "Sin responsable"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
