import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUsuario } from "@/lib/usuario";
import SinAcceso from "@/components/SinAcceso";
import ResolverMail from "@/components/ResolverMail";
import { PASOS_MARCABLES, nombreOperacion, fecha } from "@/lib/pasos";

export const dynamic = "force-dynamic";

type Mail = {
  id: string;
  fecha: string;
  asunto: string | null;
  remitente: string | null;
  url: string | null;
  cv: string | null;
  lote: string | null;
  clave: string | null;
  paso: string;
  motivo: string | null;
  estado: string;
  resuelto_por: string | null;
};

// Mails que el sistema reconoció pero no pudo asignar solo, y lo último que marcó del mail.
export default async function PorConfirmar() {
  const u = await getUsuario();
  if (!u) return null;
  if (!u.acceso) return <SinAcceso email={u.email} />;
  const puedeEditar = u.acceso.rol === "editor";

  const supabase = createClient();
  const [{ data: pendData }, { data: autoData }, { data: opsData }] = await Promise.all([
    supabase.from("op_mails").select("*").eq("estado", "pendiente").order("fecha", { ascending: false }),
    supabase.from("op_mails").select("*").eq("estado", "aplicado").eq("resuelto_por", "mail")
      .order("fecha", { ascending: false }).limit(30),
    supabase.from("op_operaciones").select("clave, cv, lote, cliente, activa").order("clave"),
  ]);
  const pendientes = (pendData ?? []) as Mail[];
  const automaticos = (autoData ?? []) as Mail[];
  const ops = (opsData ?? []) as { clave: string; cv: string; lote: string | null; cliente: string | null; activa: boolean }[];
  const nombrePaso = new Map(PASOS_MARCABLES.map((p) => [p.codigo, p.nombre]));
  const opciones = ops.map((o) => ({
    clave: o.clave,
    texto: `${nombreOperacion(o)}${o.cliente ? " · " + o.cliente : ""}${o.activa ? "" : " (cerrada)"}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-navy">Por confirmar</h1>
        <p className="text-sm text-gray-500">
          Mails que parecen un paso de una operación pero no hay certeza. Revisalos y confirmá o descartá.
        </p>
      </div>

      <section className="bg-white rounded-lg shadow">
        <h2 className="px-4 py-3 border-b font-medium text-brand-navy">
          Pendientes <span className="text-gray-400 font-normal">({pendientes.length})</span>
        </h2>
        {pendientes.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No hay nada para confirmar.</p>
        ) : (
          <ul>
            {pendientes.map((m) => (
              <li key={m.id} className="border-b last:border-0 px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium">{m.asunto || "(sin asunto)"}</div>
                  <div className="text-xs text-gray-500 whitespace-nowrap">{fecha(m.fecha.slice(0, 10), true)}</div>
                </div>
                <div className="text-xs text-gray-600">
                  De {m.remitente ?? "—"} · {m.motivo}
                  {m.url && (
                    <>
                      {" · "}
                      <a href={m.url} target="_blank" rel="noreferrer" className="underline">ver mail</a>
                    </>
                  )}
                </div>
                {puedeEditar ? (
                  <ResolverMail
                    id={m.id}
                    clave={m.clave}
                    paso={m.paso}
                    operaciones={opciones}
                    pasos={PASOS_MARCABLES.map((p) => ({ codigo: p.codigo, nombre: p.nombre }))}
                  />
                ) : (
                  <div className="text-xs text-gray-500">
                    Sugerido: {nombrePaso.get(m.paso) ?? m.paso}
                    {m.clave ? " en " + m.clave : ""}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-lg shadow">
        <h2 className="px-4 py-3 border-b font-medium text-brand-navy">Marcado solo desde el mail (últimos 30)</h2>
        {automaticos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">Todavía no se marcó nada desde el mail.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {automaticos.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-2 w-24 text-gray-500">{fecha(m.fecha.slice(0, 10))}</td>
                  <td className="px-4 py-2 w-28">
                    {m.clave ? (
                      <Link href={`/operaciones/${encodeURIComponent(m.clave)}`} className="text-brand-navy hover:underline">
                        {m.clave}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2">{nombrePaso.get(m.paso) ?? m.paso}</td>
                  <td className="px-4 py-2 text-gray-500 hidden sm:table-cell">{m.motivo}</td>
                  <td className="px-4 py-2 text-right">
                    {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="underline text-gray-500">ver mail</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 py-3 text-xs text-gray-400 border-t">
          Si alguno está mal, entrá a la operación y corregí el paso: lo que se cambia a mano no lo vuelve a pisar el mail.
        </p>
      </section>
    </div>
  );
}
