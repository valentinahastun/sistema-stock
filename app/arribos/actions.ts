"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPerfilActual } from "@/lib/supabase/profile";
import { difKg, TOLERANCIA_ARRIBO_KG } from "@/lib/arribos";

type Resultado = { ok: true } | { ok: false; error: string };

export type CpConfirmada = {
  archivo: string;
  numeroCpe: string | null;
  cargadoKg: number | null;
  descargadoKg: number | null;
  fechaDescarga: string | null;
};
export type ResultadoArribo = {
  archivo: string;
  cp: string | null;
  estado: "ok" | "diferencia" | "sin_descarga" | "no_encontrada" | "error";
  texto: string;
};

async function admin() {
  const perfil = await getPerfilActual();
  if (!perfil || perfil.rol !== "admin") throw new Error("Solo el administrador puede confirmar arribos.");
}

function refrescar() {
  ["/arribos", "/egresos", "/operaciones", "/operaciones/lista"].forEach((p) => revalidatePath(p));
}

const digitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

// Cada CPE confirmada se busca por número de CP entre los egresos y directos
// y se le guarda lo descargado, lo cargado según la CPE y la fecha de arribo.
export async function confirmarArribos(cps: CpConfirmada[]): Promise<ResultadoArribo[]> {
  try {
    await admin();
  } catch (e) {
    return cps.map((c) => ({ archivo: c.archivo, cp: c.numeroCpe, estado: "error", texto: (e as Error).message }));
  }
  const supabase = createClient();
  const res: ResultadoArribo[] = [];
  for (const c of cps) {
    const d = digitos(c.numeroCpe);
    if (d.length < 6) {
      res.push({ archivo: c.archivo, cp: c.numeroCpe, estado: "error", texto: "No pude leer el número de CP del PDF." });
      continue;
    }
    if (!c.descargadoKg) {
      res.push({
        archivo: c.archivo,
        cp: c.numeroCpe,
        estado: "sin_descarga",
        texto: "La CPE todavía no tiene los kg descargados (no está confirmada en ARCA).",
      });
      continue;
    }
    const { data } = await supabase
      .from("movimientos_stock")
      .select("id, tipo, fecha, numero_cp, cantidad")
      .in("tipo", ["egreso", "directo"])
      .ilike("numero_cp", `%${d.slice(-6)}%`)
      .limit(20);
    const ref = c.fechaDescarga ? new Date(c.fechaDescarga).getTime() : Date.now();
    const m = (data ?? [])
      .filter((x: any) => digitos(x.numero_cp) === d)
      .sort((a: any, b: any) => Math.abs(new Date(a.fecha).getTime() - ref) - Math.abs(new Date(b.fecha).getTime() - ref))[0] as
      | { id: string; tipo: string; cantidad: number }
      | undefined;
    if (!m) {
      res.push({
        archivo: c.archivo,
        cp: c.numeroCpe,
        estado: "no_encontrada",
        texto: "No encontré un egreso ni un directo con esa CP. Cargalo primero en Movimientos.",
      });
      continue;
    }
    const cargada = c.cargadoKg ? c.cargadoKg / 1000 : null;
    const descargada = c.descargadoKg / 1000;
    const { error } = await supabase
      .from("movimientos_stock")
      .update({
        cantidad_descargada: descargada,
        cantidad_cargada_cp: cargada,
        arribo_fecha: c.fechaDescarga,
        arribo_estado: null,
      })
      .eq("id", m.id);
    if (error) {
      res.push({ archivo: c.archivo, cp: c.numeroCpe, estado: "error", texto: error.message });
      continue;
    }
    const dif = difKg({
      cantidad: Number(m.cantidad),
      cantidad_cargada_cp: cargada,
      cantidad_descargada: descargada,
      arribo_estado: null,
      reclamo_estado: null,
    })!;
    const fuera = Math.abs(dif) > TOLERANCIA_ARRIBO_KG;
    res.push({
      archivo: c.archivo,
      cp: c.numeroCpe,
      estado: fuera ? "diferencia" : "ok",
      texto:
        dif === 0
          ? "Arribó justo, sin diferencia."
          : `${dif > 0 ? "Faltaron" : "Sobraron"} ${Math.abs(dif).toLocaleString("es-AR")} kg${fuera ? " (a reclamar)" : " (dentro de los 100 kg)"}.`,
    });
  }
  refrescar();
  return res;
}

export async function marcarReclamo(
  id: string,
  estado: "reclamado" | "resuelto" | null,
  a: "transportista" | "carga" | null,
  nota: string
): Promise<Resultado> {
  try {
    await admin();
    const { error } = await createClient()
      .from("movimientos_stock")
      .update({ reclamo_estado: estado, reclamo_a: a, reclamo_nota: nota.trim() || null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    refrescar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Egreso que no va a un depósito (ej.: a otra planta o terrestre): se saca de "en viaje"
export async function marcarNoAplica(id: string, si: boolean): Promise<Resultado> {
  try {
    await admin();
    const { error } = await createClient()
      .from("movimientos_stock")
      .update({ arribo_estado: si ? "no_aplica" : null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    refrescar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
