import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";

export default async function PanelPage() {
  const supabase = createClient();
  const perfil = await getPerfilActual();
  const esCalidad = perfil?.rol === "calidad";

  const { data: calidad } = await supabase.from("registros_calidad").select("id");
  const cantCalidad = (calidad ?? []).length;

  const tarjetas = [
    {
      href: "/calidad",
      titulo: "Calidad",
      descripcion: "Calidad de cada lote por planta y producto",
      valor: `${cantCalidad} registro${cantCalidad === 1 ? "" : "s"}`,
      color: "bg-amber-50",
      icono: <IconoCalidad />,
    },
  ];

  if (!esCalidad) {
    const [{ data: stock }, { data: ingresos }, { data: egresos }] = await Promise.all([
      supabase.from("stock_consolidado").select("stock_disponible_tn"),
      supabase.from("movimientos_stock").select("cantidad").eq("tipo", "ingreso"),
      supabase.from("movimientos_stock").select("cantidad").eq("tipo", "egreso"),
    ]);

    const totalStock = (stock ?? []).reduce((acc, s) => acc + Number(s.stock_disponible_tn), 0);
    const totalIngresos = (ingresos ?? []).reduce((acc, m) => acc + Number(m.cantidad), 0);
    const totalEgresos = (egresos ?? []).reduce((acc, m) => acc + Number(m.cantidad), 0);

    tarjetas.unshift({
      href: "/stock",
      titulo: "Stock",
      descripcion: "Stock disponible por planta y producto",
      valor: `${totalStock.toFixed(1)} tn`,
      color: "bg-brand-green-light",
      icono: <IconoStock />,
    });
    tarjetas.push(
      {
        href: "/ingresos",
        titulo: "Ingresos",
        descripcion: "Todo lo que entró y a qué planta",
        valor: `${totalIngresos.toFixed(1)} tn`,
        color: "bg-sky-50",
        icono: <IconoIngreso />,
      },
      {
        href: "/egresos",
        titulo: "Egresos",
        descripcion: "Todo lo que salió, de dónde y para qué",
        valor: `${totalEgresos.toFixed(1)} tn`,
        color: "bg-rose-50",
        icono: <IconoEgreso />,
      }
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-brand-navy mb-1">Panel</h1>
      <p className="text-sm text-gray-500 mb-6">
        Elegí qué querés ver.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tarjetas.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group bg-white rounded-xl shadow hover:shadow-lg transition-shadow p-5 flex items-start gap-4 border border-transparent hover:border-brand-green"
          >
            <div className={`rounded-lg p-3 ${t.color}`}>{t.icono}</div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-brand-navy group-hover:text-brand-green">
                  {t.titulo}
                </h2>
                <span className="text-lg font-semibold text-brand-navy">{t.valor}</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{t.descripcion}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function IconoStock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3f9c70" strokeWidth="1.8">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

function IconoCalidad() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="1.8">
      <path d="M12 2l7 3v6c0 5-3 8-7 11-4-3-7-6-7-11V5l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconoIngreso() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0369a1" strokeWidth="1.8">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function IconoEgreso() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="1.8">
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 19h16" />
    </svg>
  );
}
