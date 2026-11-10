// Lectura del parte de proceso que mandan las plantas en PDF.
// Por ahora: Alimentos Tropicales (Planta La Loma, "PARTE DE PROCESO Nº ...").
// Devuelve datos neutros para completar el formulario; la persona revisa y guarda.

export type IngresoParte = { fecha: string | null; kg: number; cp: string | null; procedencia: string };

export type ParteProceso = {
  planta: string; // nombre de la planta en el sistema
  formato: string;
  numero: string | null;
  producto: string | null; // "Poroto Alubia"
  fecha_inicio: string | null; // yyyy-mm-dd
  fecha_fin: string | null;
  entrada_kg: number | null;
  procesado_kg: number | null;
  bolsas_25: number | null;
  ingresos: IngresoParte[];
  // descartes por tipo del sistema, en kg
  descartes: Partial<Record<"segundilla" | "electronica" | "vibradora" | "clasificadora" | "prelimpieza" | "inutilizable", number>>;
  volatil_kg: number;
  sin_clasificar: { texto: string; kg: number }[]; // renglones de descarte que no supe a qué tipo van
  avisos: string[];
};

const kg = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function fecha(s: string | undefined | null): string | null {
  const m = (s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anio}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function tituloProducto(s: string) {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// Renglón de descarte -> tipo del sistema
function tipoDeDescarte(texto: string): keyof ParteProceso["descartes"] | "volatil" | null {
  const t = sinAcentos(texto.toLowerCase());
  if (/tierra|polvo|volatil|humedad|merma/.test(t)) return "volatil";
  if (/prelimp|zaranda/.test(t)) return "prelimpieza";
  if (/densim|vibra/.test(t)) return "vibradora";
  if (/clasif/.test(t)) return "clasificadora";
  if (/electr/.test(t)) return "electronica";
  if (/segundilla/.test(t)) return "segundilla";
  if (/inutiliz|basura/.test(t)) return "inutilizable";
  return null;
}

export function leerParteLaLoma(lineas: string[]): ParteProceso | null {
  const todo = lineas.join("\n");
  if (!/PARTE DE PROCESO/i.test(todo) || !/La Loma/i.test(todo)) return null;

  const r: ParteProceso = {
    planta: "ALIMENTOS TROPICALES",
    formato: "Alimentos Tropicales (Planta La Loma)",
    numero: todo.match(/\b(\d{3}-\d{5})\b/)?.[1] ?? null,
    producto: null,
    fecha_inicio: fecha(todo.match(/INICIO DE SERVICIO\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]),
    // Si no tiene fecha de final, la del "Actualizado al"
    fecha_fin:
      fecha(todo.match(/FINAL DE SERVICIO\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]) ??
      fecha(todo.match(/Actualizado al:?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]),
    entrada_kg: null,
    procesado_kg: null,
    bolsas_25: null,
    ingresos: [],
    descartes: {},
    volatil_kg: 0,
    sin_clasificar: [],
    avisos: [],
  };

  const prod = todo.match(/TIPO DE PRODUCTO\s+(POROTO\s+[A-ZÁÉÍÓÚÑ ]+?)\s*$/im)?.[1];
  if (prod) r.producto = tituloProducto(prod);

  // Ingresos: "8/8/2026 1 G 35.020 148 ORQ173 PALACIO ..."
  let enDescartes = false;
  for (const l of lineas) {
    const m = l.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+\d+\s+[GB]\w*\s+([\d.]+)\s+(\d+)\s+(\S+)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ. ]*?)(?=\s+\d|\s*$)/);
    if (m) r.ingresos.push({ fecha: fecha(m[1]), kg: kg(m[2]), cp: m[3], procedencia: m[5].trim() });

    if (/^ESTIBA\b/i.test(l)) { enDescartes = true; continue; }
    if (/^(DIFERENCIA|MOVIMIENTO DE MERCADER)/i.test(l)) enDescartes = false;
    if (enDescartes) {
      // "9570 descarte prelimpieza mat. Extr. 85% REND. ..." -> lo de la izquierda de "REND."/"MERMA"
      const izq = l.split(/\s+(?:REND\.|MERMA\b)/i)[0];
      const d = izq.match(/^(?:\d+\s+)?([\d.]+)\s+([a-záéíóúñ].*)$/i);
      if (d && kg(d[1]) > 0) {
        const texto = d[2].replace(/\bmat\.?\s*extr\.?.*$/i, "").trim();
        const tipo = tipoDeDescarte(texto);
        if (tipo === "volatil") r.volatil_kg += kg(d[1]);
        else if (tipo) r.descartes[tipo] = (r.descartes[tipo] ?? 0) + kg(d[1]);
        else r.sin_clasificar.push({ texto, kg: kg(d[1]) });
      }
    }
  }

  const num = (re: RegExp) => {
    const m = todo.match(re);
    return m ? kg(m[1]) : null;
  };
  r.entrada_kg = num(/TOTAL NAT MAQUINADO\s+([\d.]+)/i) ?? num(/^TOTAL\s+\d+\s+([\d.]+)/m);
  const g12 = num(/REND\. EXPORTACI[ÓO]N G1 y G2\s+[\d,]+%\s+([\d.]+)/i) ?? 0;
  const g3 = num(/REND\. EXP\. RECUPEROS G3\s+[\d,]+%\s+([\d.]+)/i) ?? 0;
  r.procesado_kg = g12 + g3 || num(/Poroto Procesado EXP\s+([\d.]+)/i);
  const segundilla = num(/REND\. RECUPEROS segundilla\s+[\d,]+%\s+([\d.]+)/i) ?? 0;
  if (segundilla > 0) r.descartes.segundilla = (r.descartes.segundilla ?? 0) + segundilla;
  const oxb = num(/REND\. RECUPEROS "?Ox\.xB"?\s+[\d,]+%\s+([\d.]+)/i) ?? 0;
  if (oxb > 0) r.sin_clasificar.push({ texto: 'recuperos "Ox.xB"', kg: oxb });
  r.volatil_kg += num(/MERMA VOLATIL \/ Humedad\s+[\d,]+%\s+([\d.]+)/i) ?? 0;

  if (/X\s*25\s*KGS/i.test(todo) && r.procesado_kg) r.bolsas_25 = Math.round(r.procesado_kg / 25);

  const sumaIngresos = r.ingresos.reduce((s, i) => s + i.kg, 0);
  if (r.entrada_kg && Math.abs(sumaIngresos - r.entrada_kg) > 1)
    r.avisos.push(`Los camiones del parte suman ${sumaIngresos.toLocaleString("es-AR")} kg y el total dice ${r.entrada_kg.toLocaleString("es-AR")} kg.`);
  if (r.entrada_kg && r.procesado_kg) {
    const desc = Object.values(r.descartes).reduce((s, x) => s + (x ?? 0), 0) + r.volatil_kg +
      r.sin_clasificar.reduce((s, x) => s + x.kg, 0);
    const dif = r.entrada_kg - r.procesado_kg - desc;
    if (Math.abs(dif) > 1)
      r.avisos.push(`Entrada menos procesado menos descartes da ${dif.toLocaleString("es-AR")} kg: lo que falte va a quedar como volátil.`);
  }
  return r;
}

export function leerParte(lineas: string[]): ParteProceso | null {
  return leerParteLaLoma(lineas);
}
