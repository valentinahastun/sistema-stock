// Lectura de una Carta de Porte a partir de una FOTO (texto sacado con OCR
// en el mismo celular, gratis). El texto de una foto llega con errores
// típicos: etiquetas mal escritas ("Obeervaciones", "Peso Neto (ka"),
// rayas de la tabla leídas como "|", "_" o "—", y letras/números cruzados
// en las patentes (S↔5, O↔0, I↔1). Acá se limpia ese texto, se le pasa al
// mismo lector de las CP en PDF (parseCp) y se completan los huecos con
// reglas de control (bruto − tara = neto, formato de patente).
// Todo lo que no cierra se devuelve en "dudas" para que la persona lo revise.

import { parseCp, type CpParseada } from "./parseCp";

const ETIQUETAS = [
  "Titular Carta de Porte:",
  "Remitente Comercial Productor:",
  "Empresa Transportista:",
  "Destinatario:",
  "Destino:",
  "Chofer :",
  "Dominios:",
  "Partida:",
  "Peso Bruto (kg):",
  "Peso Tara (kg):",
  "Peso Neto (kg):",
  "Observaciones:",
  "Grano / especie:",
  "Campaña:",
  "Fecha Descarga:",
  "Fecha Arribo:",
  "Localidad:",
  "Provincia:",
];

const SECCIONES: [string, string][] = [
  ["A", "INTERVINIENTES"],
  ["B", "GRANO"],
  ["C", "PROCEDENCIA"],
  ["D", "DESTINO"],
  ["E", "DATOS DEL TRANSPORTE"],
  ["F", "CONTINGENCIAS"],
  ["G", "DESCARGA"],
];

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const clave = (s: string) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

// Busca en la línea un tramo de 1 a 4 palabras que se parezca a la
// etiqueta (sin contar mayúsculas, acentos ni signos) y lo reemplaza por la
// etiqueta bien escrita. Con eso el lector de PDF la encuentra.
function corregirEtiqueta(linea: string, etiqueta: string): string {
  const objetivo = clave(etiqueta);
  if (linea.includes(etiqueta)) return linea;
  const palabras = [...linea.matchAll(/\S+/g)].map((m) => ({ txt: m[0], ini: m.index ?? 0 }));
  const nPalabras = etiqueta.trim().split(/\s+/).length;
  const tolerancia = objetivo.length <= 5 ? 0 : objetivo.length <= 8 ? 1 : objetivo.length <= 12 ? 2 : 3;
  let mejor: { ini: number; fin: number; d: number } | null = null;
  for (let i = 0; i < palabras.length; i++) {
    for (let n = Math.max(1, nPalabras - 1); n <= nPalabras + 1 && i + n <= palabras.length; n++) {
      const tramo = palabras.slice(i, i + n);
      const texto = tramo.map((p) => p.txt).join(" ");
      // la etiqueta puede venir pegada al valor ("Peso Neto (ka35500"): se compara sin los números del final
      const sinNumeroFinal = texto.replace(/[\d.,]+$/, "");
      const k = clave(sinNumeroFinal);
      if (!k || Math.abs(k.length - objetivo.length) > tolerancia + 1) continue;
      // las etiquetas cortas ("Destino:", "Partida:") se aceptan solo con los
      // dos puntos, para no confundirlas con palabras sueltas del texto
      if (objetivo.length <= 10 && !/[:;]\s*$/.test(sinNumeroFinal) && !/[:;]/.test(linea.slice(palabras[i].ini, palabras[i].ini + texto.length + 2))) continue;
      const d = distancia(k, objetivo);
      if (d <= tolerancia && (!mejor || d < mejor.d)) {
        const ultimo = tramo[tramo.length - 1];
        const fin = ultimo.ini + ultimo.txt.length - (texto.length - sinNumeroFinal.length);
        mejor = { ini: tramo[0].ini, fin, d };
      }
    }
  }
  if (!mejor) return linea;
  return `${linea.slice(0, mejor.ini)}${etiqueta} ${linea.slice(mejor.fin)}`.replace(/\s+/g, " ").trim();
}

export function normalizarTextoOcr(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/[|\[\]{}«»"“”_~=*]+/g, " ")
        .replace(/[—–]+/g, " ")
        .replace(/-{2,}/g, " ")
        .replace(/^-\s*(?=[^\dA-Z])/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((l) => l.length > 1)
    .map((l) => {
      // encabezados de sección: "G- DESCARGA", "B GRANO / ESPECIE"
      for (const [letra, palabra] of SECCIONES) {
        const re = new RegExp(`^${letra}\\s*[-–—.]?\\s*${palabra.split(" ")[0]}`, "i");
        if (re.test(sinAcentos(l))) return `${letra} - ${sinAcentos(l).replace(/^[A-H]\s*[-–—.]?\s*/i, "").toUpperCase()}`;
      }
      let r = l;
      for (const e of ETIQUETAS) r = corregirEtiqueta(r, e);
      // "Campajia", "Campana" -> "Campaña"; "1320 bis" -> "1320 BLS"
      return r
        .replace(/\bCampa\S{1,3}\s*:/i, "Campaña:")
        .replace(/\bA\s?[NnLlI1]ubia\b/g, "Alubia")
        .replace(/\b(\d{2,5})\s*(bis|b1s|8ls|bl5|bIs|bls)\b\.?/gi, "$1 BLS");
    });
}

// Patentes argentinas: AA123BB (Mercosur) o ABC123 (vieja). En una foto el
// OCR cruza letras y números parecidos; por la posición se sabe qué tiene
// que ir y se corrige. O/Q y 0 no siempre se pueden distinguir: por eso la
// patente siempre queda marcada para revisar.
const A_NUMERO: Record<string, string> = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", T: "1", Z: "2", S: "5", B: "8", G: "6", A: "4" };
const A_LETRA: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A" };

// Devuelve la patente corregida, o la leída tal cual (para que la persona
// la arregle) si no se pudo llevar a un formato válido.
function corregirPatente(token: string): { patente: string; valida: boolean } | null {
  // en las patentes la "l" minúscula casi siempre es una I mal leída
  const t = token.replace(/l/g, "I").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length < 5 || t.length > 8) return null;
  const molde = t.length === 7 ? "LLNNNLL" : t.length === 6 ? "LLLNNN" : null;
  if (molde) {
    const r = [...t].map((c, i) => (molde[i] === "N" ? A_NUMERO[c] ?? c : A_LETRA[c] ?? c)).join("");
    if (/^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$/.test(r)) return { patente: r, valida: true };
  }
  return /\d/.test(t) ? { patente: t, valida: false } : null;
}

export function corregirPatentes(valor: string | null): { patente: string | null; dudosas: string[] } {
  if (!valor) return { patente: null, dudosas: [] };
  const partes = valor
    .split(/\s*[-/,;.]\s*|\s{2,}/)
    .flatMap((p) => {
      const pegado = p.replace(/\s+/g, "");
      if (pegado.length >= 12 && pegado.length <= 14) {
        // dos patentes pegadas sin separador
        const corte = pegado.length - (pegado.length === 14 || pegado.length === 13 ? 7 : 6);
        return [pegado.slice(0, corte), pegado.slice(corte)];
      }
      return [pegado];
    })
    .map(corregirPatente)
    .filter((p): p is { patente: string; valida: boolean } => !!p);
  return {
    patente: partes.length ? partes.map((p) => p.patente).join(" - ") : null,
    dudosas: partes.filter((p) => !p.valida).map((p) => p.patente),
  };
}

// Terminaciones de razón social que el OCR suele deformar
function limpiarRazonSocial(v: string | null): string | null {
  if (!v) return v;
  return v
    .replace(/\s*S\s*\.?\s*A\s*\.?\s*L\s*L?\s*\.?$/i, " S.R.L.")
    .replace(/\bSs\.$/, "S.")
    .replace(/\s*\.\s*L$/, ".L")
    .replace(/[\s.,;:-]+$/, (m) => (m.includes(".") ? "." : ""))
    .trim();
}

export type CpFoto = CpParseada & { dudas: string[]; candidatosKg?: { carga: number[]; descarga: number[] } };

// Si la foto está sacada un poco de costado, los renglones de la hoja
// quedan inclinados y cada vez más a medida que se alejan del centro: la
// etiqueta de la izquierda ("Chofer:") y su valor a la derecha terminan en
// renglones distintos. Con la posición de cada palabra que da el OCR se
// estima la inclinación de cada zona de la hoja (con los renglones largos
// de alrededor) y se vuelve a armar cada renglón "enderezado".
export type PalabraOcr = { t: string; x0: number; y0: number; x1: number; y1: number };
export type LineaOcr = { baseline: { x0: number; y0: number; x1: number; y1: number }; palabras: PalabraOcr[] };

export function renglonesEnderezados(lineas: LineaOcr[]): string {
  const alturas = lineas.flatMap((l) => l.palabras.map((p) => p.y1 - p.y0)).sort((a, b) => a - b);
  const h = alturas[Math.floor(alturas.length / 2)] || 20;
  const pendiente = (l: LineaOcr) => (l.baseline.y1 - l.baseline.y0) / Math.max(1, l.baseline.x1 - l.baseline.x0);
  const largas = lineas
    .filter((l) => l.baseline.x1 - l.baseline.x0 > 12 * h && l.palabras.length >= 3)
    .map((l) => ({ y: (l.baseline.y0 + l.baseline.y1) / 2, s: pendiente(l) }));
  const mediana = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
  const sGlobal = mediana(largas.map((l) => l.s));
  const sLocal = (y: number) => {
    const cerca = largas.filter((l) => Math.abs(l.y - y) < 6 * h).map((l) => l.s);
    return cerca.length >= 2 ? mediana(cerca) : sGlobal;
  };
  const items: { t: string; x: number; y: number }[] = [];
  for (const l of lineas) {
    const s = l.baseline.x1 - l.baseline.x0 > 6 * h ? pendiente(l) : null;
    for (const p of l.palabras) {
      if (!p.t.trim()) continue;
      const x = (p.x0 + p.x1) / 2;
      const yBase = s != null ? l.baseline.y0 + s * (x - l.baseline.x0) : p.y1;
      const pend = sLocal(yBase);
      items.push({ t: p.t, x: p.x0, y: yBase - pend * x });
    }
  }
  items.sort((a, b) => a.y - b.y);
  const grupos: { y: number; items: typeof items }[] = [];
  for (const it of items) {
    const g = grupos[grupos.length - 1];
    if (g && Math.abs(it.y - g.y) < 0.55 * h) {
      g.items.push(it);
      g.y = g.items.reduce((a, b) => a + b.y, 0) / g.items.length;
    } else grupos.push({ y: it.y, items: [it] });
  }
  return grupos.map((g) => g.items.sort((a, b) => a.x - b.x).map((i) => i.t).join(" ")).join("\n");
}

const kg = (n: number) => n.toLocaleString("es-AR");

function controlarPeso(
  seccion: string[],
  previo: number | null,
  nombre: string,
  opcional = false
): { neto: number | null; duda: string | null; candidatos: number[] } {
  const numeroTras = (re: RegExp) => {
    for (const l of seccion) {
      const m = l.match(re);
      if (m) {
        const n = Number(m[1].replace(/[.,]/g, ""));
        if (n > 0) return n;
      }
    }
    return null;
  };
  const bruto = numeroTras(/Bruto\s*\(?\s*k?[a-z]?\s*\)?[\s:;.-]*([\d.,]{4,7})/i);
  const tara = numeroTras(/Tara\s*\(?\s*k?[a-z]?\s*\)?[\s:;.-]*([\d.,]{4,7})/i);
  const neto = numeroTras(/Neto\s*\(?\s*k?[a-z]?\s*\)?[\s:;.-]*([\d.,]{4,7})/i) ?? previo;
  const calculado = bruto && tara && bruto > tara ? bruto - tara : null;
  const creible = (n: number | null) => n != null && n >= 1000 && n <= 52000;
  const candidatos = [neto, calculado].filter((n): n is number => creible(n));
  const r = controlar(neto, calculado, creible, nombre, opcional, bruto, tara);
  return { ...r, candidatos };
}

function controlar(
  neto: number | null,
  calculado: number | null,
  creible: (n: number | null) => boolean,
  nombre: string,
  opcional: boolean,
  bruto: number | null,
  tara: number | null
): { neto: number | null; duda: string | null } {
  if (neto && calculado && neto !== calculado) {
    if (!creible(neto) && creible(calculado))
      return { neto: calculado, duda: `${nombre}: se leyó ${kg(neto)} pero bruto − tara da ${kg(calculado)}; se usó ${kg(calculado)}.` };
    return { neto, duda: `${nombre} ${kg(neto)} no da con bruto − tara (${kg(calculado)}): revisalo.` };
  }
  if (!neto && creible(calculado)) return { neto: calculado, duda: `${nombre} calculado como bruto − tara (${kg(calculado!)} kg).` };
  if (!neto) return { neto: null, duda: opcional && !bruto && !tara ? null : `No se leyó el ${nombre.toLowerCase()}.` };
  if (!creible(neto)) return { neto, duda: `${nombre} ${kg(neto)} kg parece mal leído.` };
  if (!calculado) return { neto, duda: `${nombre} sin poder controlarlo con bruto y tara: revisalo.` };
  return { neto, duda: null };
}

export function parseCpFoto(textoOcr: string): CpFoto {
  const lineas = normalizarTextoOcr(textoOcr);
  const d = parseCp(lineas);
  const dudas: string[] = [];

  // Número de CP: si el OCR cambió algún 0 por O, se corrige
  if (!d.numeroCpe) {
    const m = lineas.join(" ").match(/\b([0-9OoQD]{5})\s*-\s*([0-9OoQDIl]{8})\b/);
    if (m) d.numeroCpe = `${m[1]}-${m[2]}`.replace(/[OoQD]/g, "0").replace(/[Il]/g, "1");
  }
  if (!d.numeroCpe) {
    // "N° CPE ... 00001688" con el "00000-" mal leído
    const l = lineas.slice(0, 6).find((x) => /(CPE|Automotor)/i.test(x) && /\b\d{8}\b/.test(x));
    const n = l?.match(/\b(\d{8})\b/)?.[1];
    if (n) {
      d.numeroCpe = `00000-${n}`;
      dudas.push("Número de CP leído a medias: revisá que sea el correcto.");
    }
  }
  if (!d.numeroCpe) dudas.push("No se leyó el número de CP.");

  // Pesos: se controla bruto − tara = neto, en la sección B (lo cargado) y
  // en la G (lo descargado, si la CP ya está confirmada en destino)
  const iB = lineas.findIndex((l) => /^B - GRANO/.test(l));
  const iC = lineas.findIndex((l) => /^C - PROCEDENCIA/.test(l));
  const iG = lineas.findIndex((l) => /^G - DESCARGA/.test(l));
  const seccionB = iB >= 0 ? lineas.slice(iB, iC > iB ? iC : iB + 8) : lineas;
  const seccionG = iG >= 0 ? lineas.slice(iG, iG + 6) : [];
  const carga = controlarPeso(seccionB, d.pesoNetoCargaKg, "Peso neto");
  const candidatosKg = { carga: carga.candidatos, descarga: [] as number[] };
  d.pesoNetoCargaKg = carga.neto;
  if (carga.duda) dudas.push(carga.duda);
  if (iG >= 0) {
    const descarga = controlarPeso(seccionG, d.pesoNetoDescargaKg, "Kg descargados", true);
    d.pesoNetoDescargaKg = descarga.neto;
    candidatosKg.descarga = descarga.candidatos;
    if (descarga.duda) dudas.push(descarga.duda);
  }

  // Observaciones (bolsas): si no se leyó la etiqueta, se busca el renglón con bolsas
  const limpiarObs = (v: string | null) => {
    const r = (v ?? "").replace(/^(\s*Observaci\S*\s*:?)+\s*/i, "").trim();
    return /\d/.test(r) ? r : null;
  };
  d.observaciones = limpiarObs(d.observaciones);
  if (!d.observaciones) {
    for (const x of lineas.filter((x) => /Observaciones\s*:/i.test(x))) {
      d.observaciones = limpiarObs(x.replace(/^.*?Observaciones\s*:\s*/i, ""));
      if (d.observaciones) break;
    }
  }
  if (!d.observaciones) {
    const l = lineas.find((x) => /\d[\d.]*\s*(BLS|BOLSA|BOLS|BB\b|BIG|BOLSON)/i.test(x));
    if (l) d.observaciones = l.replace(/^.*?(?=\d[\d.]*\s*(BLS|BOLSA|BOLS|BB\b|BIG|BOLSON))/i, "").trim();
  }

  // Patentes
  const { patente, dudosas } = corregirPatentes(d.patente);
  d.patente = patente;
  if (!d.patente) dudas.push("No se leyó la patente.");
  else if (dudosas.length) dudas.push(`Patente mal leída (${dudosas.join(", ")}): corregila.`);

  // Chofer sin etiqueta (a veces el OCR no ve "Chofer :"): es el renglón con
  // CUIT de persona y nombre que viene después de "Flete pagador"
  if (!d.chofer) {
    const i = lineas.findIndex((l) => /Flete pagador/i.test(l));
    if (i >= 0) {
      for (const l of lineas.slice(i + 1, i + 3)) {
        if (/Intermediario|GRANO/i.test(l)) break;
        const m = l.match(/\b2[0347]\d{9}\s*-?\s*([A-ZÑ][A-ZÑ .]{4,})$/);
        if (m) {
          d.chofer = m[1].trim();
          dudas.push("Chofer leído sin su etiqueta: revisalo.");
          break;
        }
      }
    }
  }

  // Nombres: sin el CUIT de adelante (en la foto a veces falta el guion)
  const sinCuitOcr = (v: string | null) =>
    v ? v.replace(/^\D{0,3}\d{2}-?\d{8}-?\d\s*[-.]?\s*/, "").replace(/\b5\.\s*A\b/g, "S. A").trim() || v : v;
  d.chofer = sinCuitOcr(d.chofer);
  d.transportista = sinCuitOcr(d.transportista);
  d.titular = sinCuitOcr(d.titular);
  d.productor = sinCuitOcr(d.productor);
  d.destinoNombre = sinCuitOcr(d.destinoNombre);
  if (d.destino) d.destino = sinCuitOcr(d.destino);

  d.transportista = limpiarRazonSocial(d.transportista);
  d.titular = limpiarRazonSocial(d.titular);
  d.productor = limpiarRazonSocial(d.productor);

  if (!d.fechaPartida && !d.fecha) dudas.push("No se leyó la fecha.");
  if (!d.granoTipo) dudas.push("No se leyó el grano / tipo.");

  return { ...d, dudas, candidatosKg };
}

// Se lee la misma foto de dos maneras (por bloques y por renglones): cada
// una pierde cosas distintas. Se combinan: manda la primera y la segunda
// completa lo que falte. Para el peso, manda la lectura que cierra con
// bruto − tara.
export function combinarLecturas(textos: string[]): CpFoto {
  const lecturas = textos.map(parseCpFoto);
  if (lecturas.length === 1) return lecturas[0];
  const [base, ...otras] = lecturas;
  const r: CpFoto = { ...base };
  for (const o of otras) {
    for (const k of Object.keys(r) as (keyof CpParseada)[]) {
      if (r[k] == null && o[k] != null) (r as Record<string, unknown>)[k] = o[k];
    }
  }
  const cierra = (x: CpFoto) => !x.dudas.some((d) => /peso neto/i.test(d));
  const conPeso = lecturas.find((x) => cierra(x) && x.pesoNetoCargaKg);
  if (conPeso) r.pesoNetoCargaKg = conPeso.pesoNetoCargaKg;
  const cierraDescarga = (x: CpFoto) => !x.dudas.some((d) => /descargados/i.test(d));
  const conDescarga = lecturas.find((x) => cierraDescarga(x) && x.pesoNetoDescargaKg);
  if (conDescarga) r.pesoNetoDescargaKg = conDescarga.pesoNetoDescargaKg;
  // las dudas se recalculan sobre lo combinado
  const dudas = base.dudas.filter((d) => {
    if (/peso neto/i.test(d)) return !conPeso;
    if (/descargados/i.test(d)) return !conDescarga;
    if (/número de CP/.test(d)) return !r.numeroCpe;
    if (/No se leyó la patente/.test(d)) return !r.patente;
    if (/fecha/.test(d)) return !r.fechaPartida && !r.fecha;
    if (/grano/.test(d)) return !r.granoTipo;
    return true;
  });
  if (conPeso && conPeso !== base) dudas.push(...conPeso.dudas.filter((d) => /peso neto/i.test(d)));
  if (conDescarga && conDescarga !== base) dudas.push(...conDescarga.dudas.filter((d) => /descargados/i.test(d)));
  // Si ninguna lectura cierra, se usa el valor que más se repite entre todas
  const votar = (cual: "carga" | "descarga") => {
    const n = new Map<number, number>();
    for (const x of lecturas) for (const v of new Set(x.candidatosKg?.[cual] ?? [])) n.set(v, (n.get(v) ?? 0) + 1);
    const [v, veces] = [...n.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return veces >= 2 ? v : null;
  };
  if (!conPeso) {
    const v = votar("carga");
    if (v) {
      const otros = [...new Set(lecturas.flatMap((x) => x.candidatosKg?.carga ?? []))].filter((n) => n !== v);
      r.pesoNetoCargaKg = v;
      for (let i = dudas.length - 1; i >= 0; i--) if (/peso neto/i.test(dudas[i])) dudas.splice(i, 1);
      dudas.push(`Peso neto: se usó ${kg(v)} kg, que es el que más se repite al leer la foto${otros.length ? ` (también salió ${otros.map(kg).join(" / ")})` : ""}. Revisalo.`);
    }
  }
  if (!conDescarga) {
    const v = votar("descarga");
    if (v) {
      const otros = [...new Set(lecturas.flatMap((x) => x.candidatosKg?.descarga ?? []))].filter((n) => n !== v);
      r.pesoNetoDescargaKg = v;
      for (let i = dudas.length - 1; i >= 0; i--) if (/descargados/i.test(dudas[i])) dudas.splice(i, 1);
      dudas.push(`Kg descargados: se usó ${kg(v)} kg, que es el que más se repite al leer la foto${otros.length ? ` (también salió ${otros.map(kg).join(" / ")})` : ""}. Revisalo.`);
    }
  }
  if (r.patente && !r.patente.includes(" - ")) {
    dudas.push("Se leyó una sola patente: si el camión tiene acoplado, agregala.");
  }
  if (!r.patente) {
    // nada
  } else if (!base.patente) dudas.push(...otras.flatMap((o) => o.dudas.filter((d) => /Patente mal/.test(d))));
  r.dudas = [...new Set(dudas)];
  return r;
}
