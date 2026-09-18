import { createClient } from "@/lib/supabase/server";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";

// Exporta el stock consolidado (y el detalle de movimientos) a un .xlsx
// respetando los mismos filtros de planta/producto que el panel.
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const planta_id = searchParams.get("planta_id");
  const producto_id = searchParams.get("producto_id");

  const [{ data: stock }, { data: comprometido }, { data: movimientos }] =
    await Promise.all([
      supabase.from("stock_consolidado").select("*"),
      supabase.from("stock_comprometido").select("*"),
      supabase
        .from("movimientos_stock")
        .select(
          "fecha, tipo, cantidad, motivo, observaciones, lotes!lote_id(numero_cp, estado, plantas(nombre), productos(nombre), productores(nombre))"
        )
        .order("fecha", { ascending: false }),
    ]);

  const comprometidoPorClave = new Map<string, number>();
  (comprometido ?? []).forEach((c) =>
    comprometidoPorClave.set(
      `${c.planta_id}-${c.producto_id}`,
      Number(c.toneladas_comprometidas)
    )
  );

  let filas = (stock ?? []).map((s) => {
    const clave = `${s.planta_id}-${s.producto_id}`;
    const comprometidoTn = comprometidoPorClave.get(clave) ?? 0;
    return {
      planta: s.planta,
      producto: s.producto,
      planta_id: s.planta_id,
      producto_id: s.producto_id,
      disponible: Number(s.stock_disponible_tn),
      comprometido: comprometidoTn,
      libre: Number(s.stock_disponible_tn) - comprometidoTn,
    };
  });

  if (planta_id) filas = filas.filter((f) => f.planta_id === planta_id);
  if (producto_id) filas = filas.filter((f) => f.producto_id === producto_id);

  const workbook = new ExcelJS.Workbook();

  const hojaStock = workbook.addWorksheet("Stock consolidado");
  hojaStock.columns = [
    { header: "Planta", key: "planta", width: 22 },
    { header: "Producto", key: "producto", width: 22 },
    { header: "Disponible (tn)", key: "disponible", width: 16 },
    { header: "Comprometido (tn)", key: "comprometido", width: 18 },
    { header: "Libre (tn)", key: "libre", width: 14 },
  ];
  hojaStock.getRow(1).font = { bold: true };
  filas.forEach((f) =>
    hojaStock.addRow({
      planta: f.planta,
      producto: f.producto,
      disponible: f.disponible,
      comprometido: f.comprometido,
      libre: f.libre,
    })
  );

  const hojaMov = workbook.addWorksheet("Movimientos");
  hojaMov.columns = [
    { header: "Fecha", key: "fecha", width: 12 },
    { header: "Planta", key: "planta", width: 20 },
    { header: "Producto", key: "producto", width: 20 },
    { header: "Productor", key: "productor", width: 20 },
    { header: "N° CP", key: "cp", width: 14 },
    { header: "Tipo", key: "tipo", width: 12 },
    { header: "Motivo", key: "motivo", width: 16 },
    { header: "Cantidad (tn)", key: "cantidad", width: 14 },
    { header: "Observaciones", key: "obs", width: 30 },
  ];
  hojaMov.getRow(1).font = { bold: true };
  (movimientos ?? []).forEach((m: any) =>
    hojaMov.addRow({
      fecha: m.fecha,
      planta: m.lotes?.plantas?.nombre ?? "",
      producto: m.lotes?.productos?.nombre ?? "",
      productor: m.lotes?.productores?.nombre ?? "",
      cp: m.lotes?.numero_cp ?? "",
      tipo: m.tipo,
      motivo: m.motivo ?? "",
      cantidad: Number(m.cantidad),
      obs: m.observaciones ?? "",
    })
  );

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`,
    },
  });
}

