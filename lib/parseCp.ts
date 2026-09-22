// Lectura automática de Cartas de Porte Electrónica (CPE) de ARCA en PDF,
// para autocompletar el formulario de ingreso/egreso. Solo se extraen datos
// "neutros" (transporte, pesos, fechas, números de documento): nunca se
// intenta adivinar planta, producto, productor ni si es ingreso o egreso,
// porque esos campos los sigue eligiendo el operador a mano.
//
// El texto de un PDF no siempre sale en orden de lectura al extraerlo tal
// cual (los renglones de una tabla pueden salir mezclados). Por eso
// reconstruimos línea por línea usando la posición (x, y) de cada
// fragmento de texto, igual que hace un lector humano: agrupamos por
// altura (y) y adentro de cada línea ordenamos por columna (x).

export type ItemTexto = { str: string; x: number; y: number };

export function reconstruirLineas(items: ItemTexto[]): string[] {
  const tolerancia = 2.5;
  const lineas: { y: number; items: ItemTexto[] }[] = [];

  for (const it of items) {
    if (!it.str.trim()) continue;
    let linea = lineas.find((l) => Math.abs(l.y - it.y) < tolerancia);
    if (!linea) {
      linea = { y: it.y, items: [] };
      lineas.push(linea);
    }
    linea.items.push(it);
  }

  lineas.sort((a, b) => b.y - a.y);
  for (const l of lineas) {
    l.items.sort((a, b) => a.x - b.x);
  }

  return lineas.map((l) => l.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
}

export type CpParseada = {
  numeroCpe: string | null;
  ctg: string | null;
  chofer: string | null;
  transportista: string | null;
  patente: string | null;
  pesoNetoCargaKg: number | null; // sección B (origen): "kg cargados"
  pesoNetoDescargaKg: number | null; // sección G (destino): "kg descargados"
  fechaPartida: string | null; // yyyy-mm-dd
  fechaDescarga: string | null; // yyyy-mm-dd
};

// Devuelve lo que sigue a una etiqueta en una línea, cortando si aparece
// alguna de las próximas etiquetas conocidas (porque en el PDF reconstruido
// a veces dos campos quedan en el mismo renglón).
function valorTrasEtiqueta(
  linea: string,
  etiqueta: RegExp,
  cortes: RegExp[] = []
): string | null {
  const m = linea.match(etiqueta);
  if (!m || m.index === undefined) return null;
  let resto = linea.slice(m.index + m[0].length).trim();
  for (const corte of cortes) {
    const c = resto.match(corte);
    if (c && c.index !== undefined) {
      resto = resto.slice(0, c.index).trim();
    }
  }
  return resto || null;
}

function primeraLineaConEtiqueta(lineas: string[], etiqueta: RegExp): string | null {
  return lineas.find((l) => etiqueta.test(l)) ?? null;
}

// Los nombres de persona/empresa en la CP vienen precedidos por su CUIT
// ("23391401489 - DIAZ JUAN GABRIEL"); para el formulario alcanza con el
// nombre, así que se saca el CUIT si está.
function sinCuit(valor: string | null): string | null {
  if (!valor) return null;
  return valor.replace(/^\d{2}-?\d{8,11}-?\d?\s*-\s*/, "").trim() || valor;
}

function aNumero(valor: string | null): number | null {
  if (!valor) return null;
  const limpio = valor.replace(/[^\d]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "19/09/2026 20:27:00" o "19/09/2026" -> "2026-09-19"
function aFechaISO(valor: string | null): string | null {
  if (!valor) return null;
  const m = valor.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mm, y] = m;
  return `${y}-${mm.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseCp(lineas: string[]): CpParseada {
  const texto = lineas.join("\n");

  const idxSeccionB = lineas.findIndex((l) => /^B\s*-\s*GRANO/.test(l));
  const idxSeccionC = lineas.findIndex((l) => /^C\s*-\s*PROCEDENCIA/.test(l));
  const idxSeccionG = lineas.findIndex((l) => /^G\s*-\s*DESCARGA/.test(l));
  const seccionB = idxSeccionB >= 0 ? lineas.slice(idxSeccionB, idxSeccionC >= 0 ? idxSeccionC : undefined) : [];
  const seccionG = idxSeccionG >= 0 ? lineas.slice(idxSeccionG) : [];

  const numeroCpeMatch = texto.match(/\b(\d{5}-\d{8})\b/);
  const ctgMatch = texto.match(/CTG:\s*(\d+)/i);

  const lineaChofer = primeraLineaConEtiqueta(lineas, /Chofer\s*:/i);
  const chofer = sinCuit(lineaChofer ? valorTrasEtiqueta(lineaChofer, /Chofer\s*:/i) : null);

  const lineaTransportista = primeraLineaConEtiqueta(lineas, /Empresa Transportista\s*:/i);
  const transportista = sinCuit(
    lineaTransportista ? valorTrasEtiqueta(lineaTransportista, /Empresa Transportista\s*:/i) : null
  );

  const lineaDominios = primeraLineaConEtiqueta(lineas, /Dominios\s*:/i);
  const patente = lineaDominios ? valorTrasEtiqueta(lineaDominios, /Dominios\s*:/i) : null;

  const lineaPesoCarga = seccionB.find((l) => /Peso Neto\b(?!\s*\(kg\))/i.test(l));
  const pesoNetoCargaKg = aNumero(
    lineaPesoCarga ? valorTrasEtiqueta(lineaPesoCarga, /Peso Neto\b(?!\s*\(kg\))/i) : null
  );

  const lineaPesoDescarga = seccionG.find((l) => /Peso Neto\s*\(kg\)\s*:/i.test(l));
  const pesoNetoDescargaKg = aNumero(
    lineaPesoDescarga
      ? valorTrasEtiqueta(lineaPesoDescarga, /Peso Neto\s*\(kg\)\s*:/i, [/Provincia\s*:?/i])
      : null
  );

  const lineaPartida = primeraLineaConEtiqueta(lineas, /Partida\s*:/i);
  const fechaPartida = aFechaISO(
    lineaPartida ? valorTrasEtiqueta(lineaPartida, /Partida\s*:/i, [/Kms\.?/i]) : null
  );

  const lineaFechaDescarga = seccionG.find((l) => /Fecha Descarga\s*:/i.test(l));
  const fechaDescarga = aFechaISO(
    lineaFechaDescarga
      ? valorTrasEtiqueta(lineaFechaDescarga, /Fecha Descarga\s*:/i, [/Peso Tara/i, /Localidad\s*:?/i])
      : null
  );

  return {
    numeroCpe: numeroCpeMatch ? numeroCpeMatch[1] : null,
    ctg: ctgMatch ? ctgMatch[1] : null,
    chofer,
    transportista,
    patente,
    pesoNetoCargaKg,
    pesoNetoDescargaKg,
    fechaPartida,
    fechaDescarga,
  };
}
