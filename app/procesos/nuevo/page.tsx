import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import ProcesoForm, { type LoteDisponible } from "@/components/ProcesoForm";

export const dynamic = "force-dynamic";

export default async function NuevoProcesoPage() {
  const perfil = await getPerfilActual();
  if (perfil?.rol !== "admin") redirect("/procesos");
  const supabase = createClient();

  const [{ data: plantas }, { data: productos }, { data: stock }, { data: lotes }] = await Promise.all([
    supabase.from("plantas").select("id, nombre").order("nombre"),
    supabase.from("productos").select("id, nombre").order("nombre"),
    supabase
      .from("stock_lotes")
      .select("lote_id, planta_id, producto_id, productor, numero_cp, estado, fecha_ingreso, stock_actual_tn")
      .gt("stock_actual_tn", 0.0005)
      .order("fecha_ingreso"),
    supabase.from("lotes").select("id, cv, proceso_id, procesos!lotes_proceso_id_fkey(numero)"),
  ]);

  const extra = new Map<string, { cv: string | null; proceso: string | null; de_proceso: boolean }>();
  (lotes ?? []).forEach((l: any) => {
    const pr = Array.isArray(l.procesos) ? l.procesos[0] : l.procesos;
    extra.set(l.id, { cv: l.cv, proceso: pr?.numero ?? null, de_proceso: !!l.proceso_id });
  });

  const disponibles: LoteDisponible[] = (stock ?? []).map((s: any) => ({
    lote_id: s.lote_id,
    planta_id: s.planta_id,
    producto_id: s.producto_id,
    productor: s.productor,
    numero_cp: s.numero_cp,
    estado: s.estado,
    fecha_ingreso: s.fecha_ingreso,
    stock_tn: Number(s.stock_actual_tn),
    cv: extra.get(s.lote_id)?.cv ?? null,
    de_proceso: extra.get(s.lote_id)?.de_proceso ?? false,
    proceso: extra.get(s.lote_id)?.proceso ?? null,
  }));

  // Solo plantas y productos (que no sean descarte) con algo para procesar
  const conStock = new Set(disponibles.map((d) => d.planta_id));
  const prodConStock = new Set(disponibles.map((d) => d.producto_id));

  return (
    <div className="max-w-3xl">
      <Link href="/procesos" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Procesos
      </Link>
      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-4">Nuevo proceso</h1>
      <ProcesoForm
        plantas={(plantas ?? []).filter((p) => conStock.has(p.id))}
        productos={(productos ?? []).filter((p) => prodConStock.has(p.id) && !/^descarte/i.test(p.nombre))}
        lotes={disponibles}
      />
    </div>
  );
}
