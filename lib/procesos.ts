// Formatos compartidos entre la pantalla de Procesos (servidor) y sus componentes.
export const tn = (n: number | null | undefined, dec = 2) =>
  n === null || n === undefined ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });

export const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "");

export function hoyIso() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Tipos de descarte que se cargan al cerrar un proceso (volátil es lo que falta)
export const TIPOS_DESCARTE = [
  { campo: "segundilla_tn", tipo: "segundilla", nombre: "Segundilla", ayuda: "se puede volver a procesar" },
  { campo: "desc_electronica_tn", tipo: "electronica", nombre: "Desc. electrónica" },
  { campo: "desc_vibradora_tn", tipo: "vibradora", nombre: "Desc. vibradora", ayuda: "o densimétrica" },
  { campo: "desc_clasificadora_tn", tipo: "clasificadora", nombre: "Desc. clasificadora" },
  { campo: "desc_prelimpieza_tn", tipo: "prelimpieza", nombre: "Desc. prelimpieza", ayuda: "zarandas" },
  { campo: "desc_inutilizable_tn", tipo: "inutilizable", nombre: "Desc. inutilizable" },
] as const;

export type CampoDescarte = (typeof TIPOS_DESCARTE)[number]["campo"];

export const NOMBRE_TIPO_DESCARTE: Record<string, string> = Object.fromEntries(
  TIPOS_DESCARTE.map((t) => [t.tipo, t.nombre.replace("Desc. ", "Descarte ")])
);

export type ValoresCierre = {
  procesado_tn: string;
  bolsas_25: string;
  bolsas_50: string;
  big_bags: string;
  fecha_fin: string;
} & Record<CampoDescarte, string>;

export function cierreVacio(): ValoresCierre {
  return {
    procesado_tn: "", bolsas_25: "", bolsas_50: "", big_bags: "", fecha_fin: hoyIso(),
    segundilla_tn: "", desc_electronica_tn: "", desc_vibradora_tn: "", desc_clasificadora_tn: "", desc_prelimpieza_tn: "", desc_inutilizable_tn: "",
  };
}

export const numero = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));

// Cuentas del cierre: descarte total, lo cargado por tipo y el volátil (lo que falta)
export function cuentasCierre(v: ValoresCierre, entradaTn: number) {
  const proc = numero(v.procesado_tn);
  const descarte = entradaTn - proc;
  const tipos = TIPOS_DESCARTE.reduce((s, t) => s + (Number.isNaN(numero(v[t.campo])) ? 0 : numero(v[t.campo])), 0);
  return { proc, descarte, tipos, volatil: descarte - tipos };
}

export function errorCierre(v: ValoresCierre, entradaTn: number): string | null {
  const { proc, descarte, tipos } = cuentasCierre(v, entradaTn);
  if (!v.procesado_tn.trim() || Number.isNaN(proc) || proc <= 0) return "Poné cuántas tn salieron procesadas.";
  if (proc > entradaTn + 0.0005) return "Salió más de lo que entró.";
  for (const t of TIPOS_DESCARTE) {
    const n = numero(v[t.campo]);
    if (Number.isNaN(n) || n < 0) return `Revisá ${t.nombre.toLowerCase()}.`;
  }
  if (tipos > descarte + 0.0005)
    return `Los descartes suman ${tn(tipos, 3)} tn, pero entre lo que entró y lo procesado hay ${tn(descarte, 3)} tn.`;
  return null;
}

// Lo que se manda a la base: números con punto
export function cierreParaGuardar(v: ValoresCierre): ValoresCierre {
  const out = { ...v };
  (["procesado_tn", ...TIPOS_DESCARTE.map((t) => t.campo)] as (keyof ValoresCierre)[]).forEach((k) => {
    out[k] = v[k].trim() === "" ? "" : String(numero(v[k]));
  });
  return out;
}
