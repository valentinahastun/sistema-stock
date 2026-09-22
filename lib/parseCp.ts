// Lectura automática de Cartas de Porte Electrónica (CPE) de ARCA en PDF,
// para autocompletar el formulario de ingreso/egreso/movimiento directo.
// Se extraen datos "neutros" (transporte, pesos, fecha, números de
// documento, y los intervinientes de la CP tal cual figuran): nunca se
// intenta adivinar planta ni si es ingreso, egreso o directo, porque esos
// campos los sigue eligiendo el operador a mano. Titular/Productor/Destino
// se guardan solo a modo de registro/trazabilidad, no para inferir nada.
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
  fecha: string | null; // yyyy-mm-dd — fecha de emisión, arriba a la derecha del documento
  titular: string | null; // Titular de la Carta de Porte (sección A)
  productor: string | null; // Remitente Comercial Productor (sección A)
  destino: string | null; // Destino (sección A) + localidad/provincia (sección D), a modo de registro
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

// La localidad/provincia vienen en mayúsculas ("BERAZATEGUI"); para
// mostrarlas junto al destino alcanza con una capitalización simple.
function aTitulo(valor: string | null): string | null {
  if (!valor) return null;
  return valor
    .toLowerCase()
    .replace(/(^|\s)([a-záéíóúñ])/g, (_, esp, letra) => esp + letra.toUpperCase());
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

  const idxSeccionA = lineas.findIndex((l) => /^A\s*-\s*INTERVINIENTES/.test(l));
  const idxSeccionB = lineas.findIndex((l) => /^B\s*-\s*GRANO/.test(l));
  const idxSeccionC = lineas.findIndex((l) => /^C\s*-\s*PROCEDENCIA/.test(l));
  const idxSeccionD = lineas.findIndex((l) => /^D\s*-\s*DESTINO/.test(l));
  const idxSeccionE = lineas.findIndex((l) => /^E\s*-\s*DATOS DEL TRANSPORTE/.test(l));
  const idxSeccionG = lineas.findIndex((l) => /^G\s*-\s*DESCARGA/.test(l));
  const seccionA = idxSeccionA >= 0 ? lineas.slice(idxSeccionA, idxSeccionB >= 0 ? idxSeccionB : undefined) : [];
  const seccionB = idxSeccionB >= 0 ? lineas.slice(idxSeccionB, idxSeccionC >= 0 ? idxSeccionC : undefined) : [];
  const seccionD = idxSeccionD >= 0 ? lineas.slice(idxSeccionD, idxSeccionE >= 0 ? idxSeccionE : undefined) : [];
  const seccionG = idxSeccionG >= 0 ? lineas.slice(idxSeccionG) : [];

  const numeroCpeMatch = texto.match(/\b(\d{5}-\d{8})\b/);
  const ctgMatch = texto.match(/CTG:\s*(\d+)/i);

  // Fecha de emisión: siempre arriba a la derecha del documento, en el
  // mismo renglón que el título "Carta de Porte Electrónica". Es la única
  // fecha que siempre está presente (a diferencia de "Partida" o "Fecha
  // Descarga", que pueden faltar), así que es la que se usa siempre,
  // sea ingreso, egreso o movimiento directo.
  const lineaEncabezado = primeraLineaConEtiqueta(lineas, /Carta de Porte Electr[oó]nica/i);
  const fecha = aFechaISO(lineaEncabezado ? valorTrasEtiqueta(lineaEncabezado, /Fecha\s*:/i) : null);

  const lineaChofer = primeraLineaConEtiqueta(lineas, /Chofer\s*:/i);
  const chofer = sinCuit(lineaChofer ? valorTrasEtiqueta(lineaChofer, /Chofer\s*:/i) : null);

  const lineaTransportista = primeraLineaConEtiqueta(lineas, /Empresa Transportista\s*:/i);
  const transportista = sinCuit(
    lineaTransportista ? valorTrasEtiqueta(lineaTransportista, /Empresa Transportista\s*:/i) : null
  );

  const lineaDominios = primeraLineaConEtiqueta(lineas, /Dominios\s*:/i);
  const patente = lineaDominios ? valorTrasEtiqueta(lineaDominios, /Dominios\s*:/i) : null;

  const lineaTitular = seccionA.find((l) => /Titular Carta de Porte\s*:/i.test(l));
  const titular = sinCuit(
    lineaTitular ? valorTrasEtiqueta(lineaTitular, /Titular Carta de Porte\s*:/i) : null
  );

  const lineaProductor = seccionA.find((l) => /Remitente Comercial Productor\s*:/i.test(l));
  const productor = sinCuit(
    lineaProductor ? valorTrasEtiqueta(lineaProductor, /Remitente Comercial Productor\s*:/i) : null
  );

  const lineaDestino = seccionA.find((l) => /Destino\s*:/i.test(l));
  const destinoEntidad = sinCuit(lineaDestino ? valorTrasEtiqueta(lineaDestino, /Destino\s*:/i) : null);

  const lineaLocalidadDestino = seccionD.find((l) => /Localidad\s*:/i.test(l));
  const localidadDestino = aTitulo(
    lineaLocalidadDestino
      ? valorTrasEtiqueta(lineaLocalidadDestino, /Localidad\s*:/i, [/Provincia\s*:?/i])
      : null
  );
  const provinciaDestino = aTitulo(
    lineaLocalidadDestino ? valorTrasEtiqueta(lineaLocalidadDestino, /Provincia\s*:/i) : null
  );
  const lugarDestino = [localidadDestino, provinciaDestino].filter(Boolean).join(", ");
  const destino = destinoEntidad
    ? lugarDestino
      ? `${destinoEntidad} (${lugarDestino})`
      : destinoEntidad
    : null;

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

  return {
    numeroCpe: numeroCpeMatch ? numeroCpeMatch[1] : null,
    ctg: ctgMatch ? ctgMatch[1] : null,
    chofer,
    transportista,
    patente,
    pesoNetoCargaKg,
    pesoNetoDescargaKg,
    fecha,
    titular,
    productor,
    destino,
  };
}
