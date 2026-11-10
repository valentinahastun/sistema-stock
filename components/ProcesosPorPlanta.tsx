"use client";

import { Fragment, useState } from "react";
import TarjetaProceso, { type ProcesoVista } from "@/components/TarjetaProceso";
import { tn } from "@/lib/procesos";

// Procesos agrupados por planta, como el stock: cada planta es una fila con
// sus totales y al abrirla aparecen sus procesos (primero lo que está en
// proceso, después los terminados, del más nuevo al más viejo).
export default function ProcesosPorPlanta({
  procesos,
  puedeEditar,
}: {
  procesos: ProcesoVista[];
  puedeEditar: boolean;
}) {
  const grupos = new Map<string, ProcesoVista[]>();
  procesos.forEach((p) => grupos.set(p.planta, [...(grupos.get(p.planta) ?? []), p]));
  const lista = Array.from(grupos.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b bg-brand-green-light">
            <th className="px-4 py-2">Planta</th>
            <th className="px-4 py-2 text-right">Procesos</th>
            <th className="px-4 py-2 text-right">En proceso (tn)</th>
            <th className="px-4 py-2 text-right">Entró (tn)</th>
            <th className="px-4 py-2 text-right">Procesado (tn)</th>
            <th className="px-4 py-2 text-right">Descarte (tn)</th>
            <th className="px-4 py-2 text-right">Rinde</th>
          </tr>
        </thead>
        <tbody>
          {lista.map(([planta, ps]) => (
            <FilaPlanta key={planta} planta={planta} procesos={ps} puedeEditar={puedeEditar} abierta={lista.length === 1} />
          ))}
          {lista.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                No hay procesos para este filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilaPlanta({
  planta,
  procesos,
  puedeEditar,
  abierta,
}: {
  planta: string;
  procesos: ProcesoVista[];
  puedeEditar: boolean;
  abierta: boolean;
}) {
  const [abierto, setAbierto] = useState(abierta);
  const enCurso = procesos.filter((p) => p.estado === "en_proceso");
  const terminados = procesos
    .filter((p) => p.estado === "terminado")
    .sort((a, b) => ((b.fecha_fin ?? b.fecha_inicio) > (a.fecha_fin ?? a.fecha_inicio) ? 1 : -1));
  const entro = terminados.reduce((s, p) => s + p.entrada_tn, 0);
  const proc = terminados.reduce((s, p) => s + (p.procesado_tn ?? 0), 0);
  const desc = terminados.reduce((s, p) => s + (p.descarte_tn ?? 0), 0);
  const enProcesoTn = enCurso.reduce((s, p) => s + p.entrada_tn, 0);

  return (
    <Fragment>
      <tr
        className="border-b cursor-pointer hover:bg-gray-50"
        onClick={() => setAbierto(!abierto)}
      >
        <td className="px-4 py-2 font-medium text-brand-navy">
          <span className="inline-block w-4 text-gray-400">{abierto ? "▾" : "▸"}</span>
          {planta}
        </td>
        <td className="px-4 py-2 text-right">{procesos.length}</td>
        <td className={`px-4 py-2 text-right ${enProcesoTn > 0 ? "text-sky-700 font-medium" : "text-gray-400"}`}>
          {enProcesoTn > 0 ? tn(enProcesoTn) : "—"}
        </td>
        <td className="px-4 py-2 text-right">{tn(entro)}</td>
        <td className="px-4 py-2 text-right">{tn(proc)}</td>
        <td className="px-4 py-2 text-right">{tn(desc)}</td>
        <td className="px-4 py-2 text-right">{entro > 0 ? `${tn((proc / entro) * 100, 1)}%` : "—"}</td>
      </tr>
      {abierto && (
        <tr className="border-b bg-gray-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="space-y-3">
              {enCurso.length > 0 && <div className="text-xs font-semibold text-sky-700">En proceso</div>}
              {enCurso.map((p) => (
                <TarjetaProceso key={p.id} p={p} puedeEditar={puedeEditar} />
              ))}
              {terminados.length > 0 && <div className="text-xs font-semibold text-gray-600">Terminados</div>}
              {terminados.map((p) => (
                <TarjetaProceso key={p.id} p={p} puedeEditar={puedeEditar} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
