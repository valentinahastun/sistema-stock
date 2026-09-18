import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import FiltroStock from "@/components/FiltroStock";
import VincularCalidad from "@/components/VincularCalidad";
import BotonEliminarCalidad from "@/components/BotonEliminarCalidad";

type Rel = { nombre: string }[] | { nombre: string } | null;
function nombreDe(rel: Rel): string {
  if (!rel) return "";
  return Array.isArray(rel) ? rel[0]?.nombre ?? "" : rel.nombre;
}

export default async function CalidadPage({
  searchParams,
}: {
  searchParams: { planta_id?: string; producto_id?: string };
}) {
  const perfil = await getPerfilActual();
  const supabase = createClient();
  const esAdmin = perfil?.rol === "admin";
  const puedeCargar = perfil?.rol === "admin" || perfil?.rol === "calidad";

  const [{ data: plantas }, { data: productos }, { data: productores }, { data: lotes }, { data: registros }] =
    await Promise.all([
      supabase.from("plantas").select("id, nombre").order("nombre"),
      supabase.from("productos").select("id, nombre").order("nombre"),
      supabase.from("productores").select("id, nombre").order("nombre"),
      // Solo admin puede ver lotes (es dato de stock); para calidad esta
      // consulta ni se necesita, así que se evita directamente.
      esAdmin
        ? supabase
            .from("lotes")
            .select(
              "id, numero_cp, estado, planta_id, producto_id, plantas(nombre), productos(nombre), productores(nombre)"
            )
            .order("fecha_ingreso", { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("registros_calidad")
        .select(
          "id, fecha, pct_bajo_zaranda, pct_partidos, pct_arrugados, pct_otros_granos, fotos, lote_id, numero_contrato, planta_id, producto_id, productor_id, lotes(numero_cp, planta_id, producto_id, plantas(nombre), productos(nombre), productores(nombre)), plantas(nombre), productos(nombre), productores(nombre)"
        )
        .order("fecha", { ascending: false })
        .limit(300),
    ]);

  const lotesParaVincular = (lotes ?? []).map((l: any) => ({
    id: l.id,
    etiqueta: `${nombreDe(l.plantas)} · ${nombreDe(l.productos)} · ${nombreDe(l.productores)}${
      l.numero_cp ? ` · CP ${l.numero_cp}` : ""
    }`,
  }));

  type FilaRegistro = {
    id: string;
    fecha: string;
    pct_bajo_zaranda: number | null;
    pct_partidos: number | null;
    pct_arrugados: number | null;
    pct_otros_granos: number | null;
    fotos: string[] | null;
    lote_id: string | null;
    numero_contrato: string | null;
    planta_id: string | null;
    producto_id: string | null;
    productor_id: string | null;
    lotes: {
      numero_cp: string | null;
      planta_id: string;
      producto_id: string;
      plantas: Rel;
      productos: Rel;
      productores: Rel;
    } | null;
    plantas: Rel;
    productos: Rel;
    productores: Rel;
  };

  const todasLasFilas = (registros ?? []) as unknown as FilaRegistro[];

  // Para cada fila, la planta/producto/productor salen del lote si ya
  // está vinculada, o de las columnas propias si todavía es un registro
  // suelto (analizado antes de que se cargara el ingreso al sistema).
  function datosFila(f: FilaRegistro) {
    if (f.lotes) {
      return {
        planta: nombreDe(f.lotes.plantas),
        producto: nombreDe(f.lotes.productos),
        productor: nombreDe(f.lotes.productores),
        cp: f.lotes.numero_cp ?? "—",
        planta_id: f.lotes.planta_id,
        producto_id: f.lotes.producto_id,
        vinculado: true,
      };
    }
    return {
      planta: nombreDe(f.plantas) || "—",
      producto: nombreDe(f.productos) || "—",
      productor: nombreDe(f.productores) || "—",
      cp: "—",
      planta_id: f.planta_id,
      producto_id: f.producto_id,
      vinculado: false,
    };
  }

  let filas = todasLasFilas;
  if (searchParams.planta_id) {
    filas = filas.filter((f) => datosFila(f).planta_id === searchParams.planta_id);
  }
  if (searchParams.producto_id) {
    filas = filas.filter((f) => datosFila(f).producto_id === searchParams.producto_id);
  }

  const sueltos = esAdmin ? todasLasFilas.filter((f) => !f.lote_id) : [];

  const pct = (n: number | null) => (n === null ? "—" : `${Number(n).toFixed(2)}%`);

  return (
    <div>
      <Link href="/" className="text-sm text-gray-500 hover:text-brand-navy">
        ← Volver al panel
      </Link>

      <div className="flex items-center justify-between mt-2 mb-4">
        <h1 className="text-xl font-semibold text-brand-navy">Calidad</h1>
        {puedeCargar && (
          <Link
            href="/calidad/cargar"
            className="text-sm bg-brand-green hover:bg-brand-green-dark text-white rounded px-3 py-1.5"
          >
            Cargar calidad
          </Link>
        )}
      </div>

      {esAdmin && sueltos.length > 0 && (
        <div className="mb-6 max-w-2xl bg-white rounded-lg shadow p-6">
          <h2 className="font-medium text-brand-navy mb-1">
            Registros de calidad sin vincular ({sueltos.length})
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Se cargaron antes de que el lote existiera en el sistema. Cuando
            cargues el ingreso, vinculalos acá.
          </p>
          <div className="space-y-3">
            {sueltos.map((f) => {
              const d = datosFila(f);
              return (
                <VincularCalidad
                  key={f.id}
                  registroId={f.id}
                  etiqueta={`${d.planta} · ${d.producto}${
                    f.numero_contrato ? ` · contrato ${f.numero_contrato}` : ""
                  } · ${f.fecha}`}
                  lotes={lotesParaVincular}
                />
              );
            })}
          </div>
        </div>
      )}

      <FiltroStock
        plantas={plantas ?? []}
        productos={productos ?? []}
        plantaSeleccionada={searchParams.planta_id ?? ""}
        productoSeleccionado={searchParams.producto_id ?? ""}
        basePath="/calidad"
      />

      <div className="bg-white rounded-lg shadow mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-brand-green-light">
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Planta</th>
              <th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Productor</th>
              <th className="px-4 py-2">CP / contrato</th>
              <th className="px-4 py-2 text-right">Bajo zaranda</th>
              <th className="px-4 py-2 text-right">Partidos</th>
              <th className="px-4 py-2 text-right">Arrugados</th>
              <th className="px-4 py-2 text-right">Otros granos</th>
              <th className="px-4 py-2">Fotos</th>
              {esAdmin && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const d = datosFila(f);
              return (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">{f.fecha}</td>
                  <td className="px-4 py-2">{d.planta}</td>
                  <td className="px-4 py-2">{d.producto}</td>
                  <td className="px-4 py-2">{d.productor}</td>
                  <td className="px-4 py-2">
                    {d.vinculado ? d.cp : (
                      <span className="text-amber-700">
                        {f.numero_contrato ? `contrato ${f.numero_contrato}` : "sin vincular"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">{pct(f.pct_bajo_zaranda)}</td>
                  <td className="px-4 py-2 text-right">{pct(f.pct_partidos)}</td>
                  <td className="px-4 py-2 text-right">{pct(f.pct_arrugados)}</td>
                  <td className="px-4 py-2 text-right">{pct(f.pct_otros_granos)}</td>
                  <td className="px-4 py-2">
                    {f.fotos && f.fotos.length > 0 ? (
                      <div className="flex gap-1">
                        {f.fotos.slice(0, 3).map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer">
                            <img
                              src={url}
                              alt="foto de calidad"
                              className="w-8 h-8 object-cover rounded border"
                            />
                          </a>
                        ))}
                        {f.fotos.length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{f.fotos.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  {esAdmin && (
                    <td className="px-4 py-2">
                      <BotonEliminarCalidad registroId={f.id} />
                    </td>
                  )}
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 11 : 10} className="px-4 py-6 text-center text-gray-400">
                  No hay registros de calidad todavía para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
