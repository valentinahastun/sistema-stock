import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { difKg, estadoArribo } from "@/lib/arribos";

// En el detalle de la operación: camiones de ese CV en viaje / arribados al depósito
export default async function ResumenArribos({ cv }: { cv: string | null }) {
  if (!cv) return null;
  const { data } = await createClient()
    .from("movimientos_stock")
    .select("cantidad, cantidad_cargada_cp, cantidad_descargada, arribo_estado, reclamo_estado")
    .in("tipo", ["egreso", "directo"])
    .not("numero_cp", "is", null)
    .eq("cv", cv);
  const ms = (data ?? []).map((m: any) => ({
    cantidad: Number(m.cantidad),
    cantidad_cargada_cp: m.cantidad_cargada_cp == null ? null : Number(m.cantidad_cargada_cp),
    cantidad_descargada: m.cantidad_descargada == null ? null : Number(m.cantidad_descargada),
    arribo_estado: m.arribo_estado,
    reclamo_estado: m.reclamo_estado,
  })).filter((m) => estadoArribo(m) !== "no_aplica");
  if (!ms.length) return null;
  const enViaje = ms.filter((m) => estadoArribo(m) === "en_viaje").length;
  const arribados = ms.filter((m) => m.cantidad_descargada != null);
  const conDif = arribados.filter((m) => estadoArribo(m) === "diferencia" && m.reclamo_estado !== "resuelto");
  const cargado = arribados.reduce((s, m) => s + (m.cantidad_cargada_cp ?? m.cantidad), 0);
  const descargado = arribados.reduce((s, m) => s + (m.cantidad_descargada ?? 0), 0);
  const kgDif = arribados.reduce((s, m) => s + (difKg(m) ?? 0), 0);
  const f = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return (
    <div className="mt-4 pt-4 border-t text-sm">
      <div className="text-xs text-gray-500 mb-1">Camiones a depósito</div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>🚚 {enViaje} en viaje</span>
        <span>✓ {arribados.length} arribados</span>
        {arribados.length > 0 && (
          <span className="text-gray-600">
            cargado {f(cargado)} tn · descargado {f(descargado)} tn ({kgDif >= 0 ? "−" : "+"}
            {Math.abs(Math.round(kgDif)).toLocaleString("es-AR")} kg)
          </span>
        )}
        {conDif.length > 0 && <span className="text-red-600 font-medium">⚠ {conDif.length} con diferencia a reclamar</span>}
        <Link href="/arribos" className="text-brand-navy underline text-xs">Ver arribos</Link>
      </div>
    </div>
  );
}
