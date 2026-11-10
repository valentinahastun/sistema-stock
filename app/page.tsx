import { createClient } from "@/lib/supabase/server";
import { getAccesos } from "@/lib/accesos";
import PortadaVista, { type Modulo, IconoBarco, IconoStock, IconoCalidad } from "@/components/PortadaVista";

export const dynamic = "force-dynamic";


const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Portada de la plataforma: un recuadro por módulo con lo principal de cada uno.
export default async function Portada() {
  const a = await getAccesos();
  if (!a) return null;
  const supabase = createClient();

  const ahora = new Date(Date.now() - 3 * 3600 * 1000); // Buenos Aires
  const fechaLarga = `${DIAS[ahora.getUTCDay()]} ${ahora.getUTCDate()} de ${MESES[ahora.getUTCMonth()]}`;

  const modulos: Modulo[] = [];

  if (a.operaciones) {
    const { data } = await supabase.rpc("op_alertas");
    const alertas = (data ?? []) as { nivel: string; responsable: string | null }[];
    const mias = a.operaciones.responsable ? alertas.filter((x) => x.responsable === a.operaciones!.responsable) : alertas;
    const hoy = mias.filter((x) => x.nivel === "vencida").length;
    const { count } = await supabase.from("op_operaciones").select("clave", { count: "exact", head: true }).eq("activa", true);
    modulos.push({
      titulo: "Operaciones",
      href: "/operaciones",
      icono: <IconoBarco />,
      color: "bg-sky-50",
      numeros: [
        { valor: String(hoy), texto: a.operaciones.responsable ? "tuyas para resolver hoy" : "para resolver hoy", clase: hoy ? "text-rose-600" : "text-brand-navy" },
        { valor: String(count ?? 0), texto: "operaciones abiertas" },
      ],
      links: [
        { href: "/operaciones", texto: "Pendientes de hoy" },
        { href: "/operaciones/lista", texto: "Operaciones abiertas" },
      ],
    });
  }

  if (a.stock) {
    const [{ data: stock }, { data: ingresos }, { data: egresos }] = await Promise.all([
      supabase.from("stock_consolidado").select("stock_disponible_tn"),
      supabase.from("movimientos_stock").select("cantidad").eq("tipo", "ingreso").is("proceso_id", null),
      supabase.from("movimientos_stock").select("cantidad").eq("tipo", "egreso").is("proceso_id", null),
    ]);
    const suma = (l: { [k: string]: unknown }[] | null, k: string) => (l ?? []).reduce((s, x) => s + Number(x[k]), 0);
    const tn = (n: number, dec = 1) => n.toLocaleString("es-AR", { maximumFractionDigits: dec });
    modulos.push({
      titulo: "Stock",
      href: "/stock",
      icono: <IconoStock />,
      color: "bg-brand-green-light",
      numeros: [
        { valor: `${tn(suma(stock, "stock_disponible_tn"))} tn`, texto: "disponibles" },
        { valor: `${tn(suma(ingresos, "cantidad"), 0)} / ${tn(suma(egresos, "cantidad"), 0)} tn`, texto: "ingresos / egresos" },
      ],
      links: [
        { href: "/stock", texto: "Stock" },
        { href: "/procesos", texto: "Procesos" },
        { href: "/ingresos", texto: "Ingresos" },
        { href: "/egresos", texto: "Egresos" },
      ],
    });
  }

  if (a.calidad) {
    const { count } = await supabase.from("registros_calidad").select("id", { count: "exact", head: true });
    modulos.push({
      titulo: "Calidad",
      href: "/calidad",
      icono: <IconoCalidad />,
      color: "bg-amber-50",
      numeros: [{ valor: String(count ?? 0), texto: "análisis cargados" }],
      links: [
        { href: "/calidad", texto: "Calidad" },
        ...(a.perfil?.rol === "admin" || a.perfil?.rol === "calidad" ? [{ href: "/calidad/cargar", texto: "Cargar calidad" }] : []),
      ],
    });
  }

  return <PortadaVista nombre={a.nombre} email={a.email} fechaLarga={fechaLarga} modulos={modulos} />;
}
