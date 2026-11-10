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
    supabase.from("productos").select("id, nombre, producto_descarte_id").order("nombre"),
    supabase
      .from("stock_lotes")
      .select("lote_id, planta_id, producto_id, productor, numero_cp, estado, fecha_ingreso, stock_actual_tn")
      .gt("stock_actual_tn", 0.0005)
      .order("fecha_ingreso"),
    supabase.from("lotes").select("id, cv, tipo_descarte, proceso_id, procesos!lotes_proceso_id_fkey(numero)"),
  ]);

  const extra = new Map<string, { cv: string | null; proceso: string | null; de_proceso: boolean; tipo_descarte: string | null }>();
  (lotes ?? []).forEach((l: any) => {
    const pr = Array.isArray(l.procesos) ? l.procesos[0] : l.procesos;
    extra.set(l.id, { cv: l.cv, proceso: pr?.numero ?? null, de_proceso: !!l.proceso_id, tipo_descarte: l.tipo_descarte });
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
    tipo_descarte: extra.get(s.lote_id)?.tipo_descarte ?? null,
  }));

  // Producto de descarte de cada producto (por catálogo o por nombre: "Descarte Negro"),
  // para que la segundilla pueda volver a entrar en un proceso de su producto
  const catalogo = (productos ?? []) as { id: string; nombre: string; producto_descarte_id: string | null }[];
  const descarteDe: Record<string, string> = {};
  catalogo.forEach((p) => {
    const porNombre = catalogo.find((d) => d.nombre === `Descarte ${p.nombre.replace(/^Poroto\s+/i, "").trim()}`);
    const id = p.producto_descarte_id ?? porNombre?.id;
    if (id) descarteDe[p.id] = id;
  });
  // La segundilla se ofrece como entrada del producto original
  const productoDeSegundilla = new Map(Object.entries(descarteDe).map(([p, d]) => [d, p]));
  disponibles.forEach((d) => {
    if (d.tipo_descarte === "segundilla" && productoDeSegundilla.has(d.producto_id)) {
      d.producto_id = productoDeSegundilla.get(d.producto_id)!;
    }
  });
  const procesables = disponibles.filter((d) => !d.tipo_descarte || d.tipo_descarte === "segundilla");

  // Solo plantas y productos (que no sean descarte) con algo para procesar
  const conStock = new Set(procesables.map((d) => d.planta_id));
  const prodConStock = new Set(procesables.map((d) => d.producto_id));

  return (
    <div className="max-w-3xl">
      <Link href="/procesos" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Procesos
      </Link>
      <h1 className="text-xl font-semibold text-brand-navy mt-2 mb-4">Nuevo proceso</h1>
      <ProcesoForm
        plantas={(plantas ?? []).filter((p) => conStock.has(p.id))}
        productos={catalogo.filter((p) => prodConStock.has(p.id) && !/^descarte/i.test(p.nombre))}
        lotes={procesables}
      />
    </div>
  );
}
