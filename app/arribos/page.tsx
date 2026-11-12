import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import SubirArribos from "@/components/SubirArribos";
import { BotonNoAplica, Reclamo } from "@/components/AccionesArribo";
import { difKg, estadoArribo, TOLERANCIA_ARRIBO_KG, type EstadoArribo } from "@/lib/arribos";

export const dynamic = "force-dynamic";

type Rel = { nombre: string }[] | { nombre: string } | null;
const nombre = (r: Rel) => (!r ? "" : Array.isArray(r) ? r[0]?.nombre ?? "" : r.nombre);
const dm = (f: string | null) => (f ? f.split("-").reverse().slice(0, 2).join("/") : "—");
const tn = (n: number | null) => (n == null ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

type Fila = {
  id: string;
  tipo: string;
  fecha: string;
  numero_cp: string | null;
  cv: string | null;
  cantidad: number;
  cantidad_cargada_cp: number | null;
  cantidad_descargada: number | null;
  arribo_fecha: string | null;
  arribo_estado: string | null;
  reclamo_estado: string | null;
  reclamo_a: string | null;
  reclamo_nota: string | null;
  transportista: string | null;
  patente: string | null;
  destino: string | null;
  planta: string;
  producto: string;
  estado: EstadoArribo;
  dif: number | null;
  dias: number;
};

export default async function ArribosPage() {
  const perfil = await getPerfilActual();
  const esAdmin = perfil?.rol === "admin";
  const desde = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);

  const { data } = await createClient()
    .from("movimientos_stock")
    .select(
      "id, tipo, fecha, numero_cp, cv, cantidad, cantidad_cargada_cp, cantidad_descargada, arribo_fecha, arribo_estado, reclamo_estado, reclamo_a, reclamo_nota, transportista, patente, destino, plantas(nombre), productos(nombre)"
    )
    .in("tipo", ["egreso", "directo"])
    .is("proceso_id", null)
    .not("numero_cp", "is", null)
    .gte("fecha", desde)
    .order("fecha", { ascending: false });

  const hoy = Date.now();
  const filas: Fila[] = (data ?? []).map((m: any) => {
    const base = {
      cantidad: Number(m.cantidad),
      cantidad_cargada_cp: m.cantidad_cargada_cp == null ? null : Number(m.cantidad_cargada_cp),
      cantidad_descargada: m.cantidad_descargada == null ? null : Number(m.cantidad_descargada),
      arribo_estado: m.arribo_estado,
      reclamo_estado: m.reclamo_estado,
    };
    return {
      ...m,
      ...base,
      planta: m.tipo === "directo" ? "Directo" : nombre(m.plantas),
      producto: nombre(m.productos),
      estado: estadoArribo(base),
      dif: difKg(base),
      dias: Math.floor((hoy - new Date(m.fecha).getTime()) / 864e5),
    };
  });

  const conDif = filas.filter((f) => f.estado === "diferencia").sort((a, b) => (a.reclamo_estado === "resuelto" ? 1 : 0) - (b.reclamo_estado === "resuelto" ? 1 : 0));
  const enViaje = filas.filter((f) => f.estado === "en_viaje");
  const ok = filas.filter((f) => f.estado === "ok");
  const noAplica = filas.filter((f) => f.estado === "no_aplica");
  const aReclamarKg = conDif.filter((f) => f.reclamo_estado !== "resuelto").reduce((s, f) => s + Math.max(f.dif ?? 0, 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-navy">Arribos a depósito</h1>
        <p className="text-sm text-gray-500">
          Camiones que salieron con CP (egresos y directos de los últimos 4 meses). Al subir la CPE confirmada en ARCA se compara lo
          cargado con lo descargado: hasta {TOLERANCIA_ARRIBO_KG} kg está bien.
        </p>
      </div>

      {esAdmin && <SubirArribos />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cuadro t="En viaje" v={enViaje.length} clase="text-sky-700" />
        <Cuadro t="Con diferencia" v={conDif.filter((f) => f.reclamo_estado !== "resuelto").length} clase="text-red-600" />
        <Cuadro t="Kg a reclamar" v={aReclamarKg.toLocaleString("es-AR")} clase="text-red-600" />
        <Cuadro t="Arribados OK" v={ok.length} clase="text-green-700" />
      </div>

      <Grupo titulo="⚠ Con diferencia" vacio="No hay arribos con diferencia.">
        {conDif.length > 0 && (
          <Tabla
            filas={conDif}
            extra={(f) => (
              <div className="space-y-1">
                <div className={`font-medium ${(f.dif ?? 0) > 0 ? "text-red-600" : "text-amber-700"}`}>
                  {(f.dif ?? 0) > 0 ? "Faltan" : "Sobran"} {Math.abs(f.dif ?? 0).toLocaleString("es-AR")} kg
                </div>
                {esAdmin ? (
                  <Reclamo id={f.id} estado={f.reclamo_estado} a={f.reclamo_a} nota={f.reclamo_nota} />
                ) : (
                  <div className="text-xs text-gray-500">{f.reclamo_estado ?? "sin reclamar"}</div>
                )}
              </div>
            )}
          />
        )}
      </Grupo>

      <Grupo titulo="🚚 En viaje" vacio="No hay camiones esperando arribo.">
        {enViaje.length > 0 && (
          <Tabla
            filas={enViaje}
            extra={(f) => (
              <div className="space-y-1">
                <div className={f.dias > 10 ? "text-amber-700 font-medium" : "text-gray-600"}>hace {f.dias} días</div>
                {esAdmin && <BotonNoAplica id={f.id} />}
              </div>
            )}
          />
        )}
      </Grupo>

      <Grupo titulo="✓ Arribados OK" vacio="Todavía no se confirmó ningún arribo." cerrado>
        {ok.length > 0 && (
          <Tabla
            filas={ok}
            extra={(f) => (
              <span className="text-green-700">
                {f.dif === 0 ? "justo" : `${(f.dif ?? 0) > 0 ? "−" : "+"}${Math.abs(f.dif ?? 0)} kg`}
              </span>
            )}
          />
        )}
      </Grupo>

      {noAplica.length > 0 && (
        <Grupo titulo="No van a depósito" vacio="" cerrado>
          <Tabla filas={noAplica} extra={(f) => (esAdmin ? <BotonNoAplica id={f.id} deshacer /> : null)} />
        </Grupo>
      )}
    </div>
  );
}

function Cuadro({ t, v, clase }: { t: string; v: number | string; clase: string }) {
  return (
    <div className="bg-white rounded-lg shadow px-4 py-3">
      <div className="text-xs text-gray-500">{t}</div>
      <div className={`text-xl font-semibold ${clase}`}>{v}</div>
    </div>
  );
}

function Grupo({ titulo, vacio, cerrado, children }: { titulo: string; vacio: string; cerrado?: boolean; children: React.ReactNode }) {
  return (
    <details open={!cerrado} className="bg-white rounded-lg shadow">
      <summary className="px-4 py-3 font-semibold text-brand-navy cursor-pointer">{titulo}</summary>
      <div className="px-2 pb-3">{children || <p className="px-2 text-sm text-gray-400">{vacio}</p>}</div>
    </details>
  );
}

function Tabla({ filas, extra }: { filas: Fila[]; extra: (f: Fila) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b text-gray-500 text-xs">
            <th className="px-2 py-2">Salió</th>
            <th className="px-2 py-2">CP</th>
            <th className="px-2 py-2">CV</th>
            <th className="px-2 py-2">De</th>
            <th className="px-2 py-2">Producto</th>
            <th className="px-2 py-2">Transporte</th>
            <th className="px-2 py-2 text-right">Cargado (tn)</th>
            <th className="px-2 py-2 text-right">Descargado (tn)</th>
            <th className="px-2 py-2">Arribo</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-b last:border-0 align-top">
              <td className="px-2 py-2 whitespace-nowrap">{dm(f.fecha)}</td>
              <td className="px-2 py-2 whitespace-nowrap">{f.numero_cp}</td>
              <td className="px-2 py-2 whitespace-nowrap">{f.cv ?? "—"}</td>
              <td className="px-2 py-2">{f.planta}</td>
              <td className="px-2 py-2">{f.producto}</td>
              <td className="px-2 py-2 text-xs">
                {f.transportista ?? "—"}
                {f.patente && <div className="text-gray-500">{f.patente}</div>}
              </td>
              <td className="px-2 py-2 text-right">{tn(f.cantidad_cargada_cp ?? f.cantidad)}</td>
              <td className="px-2 py-2 text-right">{tn(f.cantidad_descargada)}</td>
              <td className="px-2 py-2 whitespace-nowrap">{dm(f.arribo_fecha)}</td>
              <td className="px-2 py-2 text-xs">{extra(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
