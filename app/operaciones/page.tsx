import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import FiltroResponsable from "@/components/FiltroResponsable";
import { type Alerta, type Operacion, fecha } from "@/lib/pasos";
import VistaInicio, { type Evento } from "@/components/VistaInicio";

export const dynamic = "force-dynamic";

// Inicio: lo que hay que hacer hoy y lo que viene en los próximos días.
export default async function Inicio({ searchParams }: { searchParams: { resp?: string } }) {
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

  const eventos: Evento[] = [];
  filtrar((cargasData ?? []) as Operacion[]).forEach((op) => {
    const dentro = (d: string | null) => d && d >= hoy && d <= en7;
    if (dentro(op.fecha_carga_planta)) eventos.push({ dia: op.fecha_carga_planta!, tipo: "carga", op });
    if (dentro(op.fecha_consolidado)) eventos.push({ dia: op.fecha_consolidado!, tipo: "consolidado", op });
    if (dentro(op.corte_documental)) eventos.push({ dia: op.corte_documental!, tipo: "corte", op });
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Inicio</h1>
          <p className="text-sm text-slate-500">Hoy {fecha(hoy, true)}</p>
        </div>
        <FiltroResponsable base="/operaciones" actual={resp} />
      </div>
      {error && <p className="text-sm text-red-600">No se pudieron calcular las alertas: {error.message}</p>}
      <VistaInicio alertas={alertas} eventos={eventos} hoy={hoy} />
    </div>
  );
}
