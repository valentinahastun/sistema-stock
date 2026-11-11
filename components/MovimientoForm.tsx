"use client";

import { useEffect, useRef, useState } from "react";
import { crearIngreso, crearMovimientoDirecto, crearEgreso, buscarCpCargada, type CpCargada } from "@/app/movimientos/actions";
import { crearDesdeCp } from "@/app/catalogos/actions";
import { normalizarCv } from "@/lib/cv";
import { leerBolsas } from "@/lib/bolsas";

type Catalogo = { id: string; nombre: string };

type DatosCp = {
  numeroCpe: string | null;
  ctg: string | null;
  chofer: string | null;
  transportista: string | null;
  patente: string | null;
  pesoNetoCargaKg: number | null;
  pesoNetoDescargaKg: number | null;
  fecha: string | null;
  fechaPartida?: string | null;
  fechaDescarga?: string | null;
  titular: string | null;
  productor: string | null;
  destino: string | null;
  destinoNombre?: string | null;
  granoTipo: string | null;
  observaciones?: string | null;
};

type Tipo = "ingreso" | "egreso" | "directo";

// Para el movimiento Directo, el producto (que en la CP viene como texto
// libre en "Grano / Poroto Tipo") se intenta asociar con las reglas que
// confirmó el usuario. Reglas en orden: la primera que matchea gana. Las
// variedades con nombre propio en la CP (Alubia, Negro, Cranberry,
// Garbanzo, Mung) matchean por ese nombre; Adzuki no tiene nombre propio
// en la CP (la describen como "distinto" del oval blanco), así que es el
// catch-all: cualquier "poroto" que no haya matcheado antes. Colorado es
// un caso aparte: la CP no distingue Dark de Light, así que nunca se
// autocompleta (lo elige la persona a mano), aunque diga "poroto". El
// campo queda siempre editable para corregir cualquiera de estos casos
// antes de guardar.
const REGLAS_PRODUCTO_DIRECTO: { patron: RegExp; nombreProducto: string }[] = [
  { patron: /alubia/i, nombreProducto: "Poroto Alubia" },
  { patron: /negro/i, nombreProducto: "Poroto Negro" },
  { patron: /cranberry/i, nombreProducto: "Poroto Cranberry" },
  { patron: /garbanzo/i, nombreProducto: "Garbanzo" },
  { patron: /mung/i, nombreProducto: "Poroto Mungo" },
  { patron: /poroto/i, nombreProducto: "Poroto Adzuki" },
];

function detectarProductoId(granoTipo: string | null, productos: Catalogo[]): string | null {
  if (!granoTipo) return null;
  // Colorado Dark vs Light no se distingue en el texto de la CP: mejor no
  // adivinar y que se elija a mano, en vez de arriesgar el catch-all de Adzuki.
  if (/colorado/i.test(granoTipo)) return null;
  const sinDescarte = productos.filter((p) => !/^descarte/i.test(p.nombre.trim()));
  for (const regla of REGLAS_PRODUCTO_DIRECTO) {
    if (regla.patron.test(granoTipo)) {
      const exacto = sinDescarte.find(
        (p) => p.nombre.trim().toLowerCase() === regla.nombreProducto.toLowerCase()
      );
      if (exacto) return exacto.id;
      // Si el catálogo lo nombra distinto ("Poroto Mung" / "Mung"), alcanza con la palabra clave
      const clave = regla.nombreProducto.replace(/^Poroto\s+/i, "").slice(0, 4).toLowerCase();
      const parecido = sinDescarte.find((p) => p.nombre.toLowerCase().includes(clave));
      if (parecido) return parecido.id;
    }
  }
  return null;
}

// Emisores que figuran en la CP con otro nombre que el que usamos nosotros
// (por ejemplo, la razón social de la planta). Se reemplazan antes de buscar.
const ALIAS_EMISOR: { patron: RegExp; nombre: string }[] = [
  { patron: /agro\s*bull/i, nombre: "BIURRUM" },
];

function conAlias(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  return ALIAS_EMISOR.find((a) => a.patron.test(nombre))?.nombre ?? nombre;
}

// Para comparar nombres de la CP con los del catálogo: sin acentos, sin
// puntuación y sin la sociedad ("S.R.L.", "S.A.", "SAS"...).
function normalizar(n: string): string {
  return n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(S\s*R\s*L|S\s*A\s*S|S\s*A|S\s*C|S\s*H|SOCIEDAD ANONIMA|SRL|SAS|SA)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buscarEnCatalogo(nombre: string | null | undefined, catalogo: Catalogo[]): Catalogo | null {
  if (!nombre) return null;
  const n = normalizar(nombre);
  if (!n) return null;
  const exacto = catalogo.find((c) => normalizar(c.nombre) === n);
  if (exacto) return exacto;
  return (
    catalogo.find((c) => {
      const cn = normalizar(c.nombre);
      return cn.length >= 4 && (n.includes(cn) || cn.includes(n));
    }) ?? null
  );
}

export type LoteConProductor = {
  planta_id: string;
  producto_id: string;
  productor_id: string | null;
  cv?: string | null;
  tn: number;
};
type Nota = { tipo: "ok" | "aviso"; texto: string };
// Diferencias de balanza aceptadas
const TOLERANCIA_EGRESO_KG = 200; // egreso que supera el stock: se carga igual y deja el stock en 0
const TOLERANCIA_INGRESO_KG = 100; // ingreso: diferencia entre kg cargados y descargados que dispara aviso
type Pista = { nombre: string | null; de: string };
type Contexto = {
  plantaId: string;
  productoId: string;
  cv: string | null;
  lotes: LoteConProductor[];
  productores: Catalogo[];
  plantas: Catalogo[];
  productos: Catalogo[];
};

function fmtTn(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function stockDe(lotes: LoteConProductor[], plantaId: string, productoId: string, productorId: string) {
  return lotes
    .filter((l) => l.planta_id === plantaId && (!productoId || l.producto_id === productoId) && l.productor_id === productorId)
    .reduce((s, l) => s + l.tn, 0);
}

// Productores (con sus tn) de un grupo de lotes, del que más tiene al que menos
function productoresDe(lotes: LoteConProductor[], productores: Catalogo[]) {
  const tn = new Map<string, number>();
  lotes.forEach((l) => l.productor_id && tn.set(l.productor_id, (tn.get(l.productor_id) ?? 0) + l.tn));
  return productores
    .filter((p) => (tn.get(p.id) ?? 0) > 0.0005)
    .map((p) => ({ ...p, tn: tn.get(p.id)! }))
    .sort((a, b) => b.tn - a.tn);
}

function listar(ps: { nombre: string; tn: number }[]) {
  return ps.slice(0, 6).map((p) => `${p.nombre} (${fmtTn(p.tn)} tn)`).join(", ") + (ps.length > 6 ? "…" : "");
}

function deAca(c: Contexto) {
  return c.lotes.filter((l) => l.planta_id === c.plantaId && (!c.productoId || l.producto_id === c.productoId));
}

// Aviso si el CV no tiene mercadería en esta planta/producto (y dónde está, si está en otro lado)
function avisoCvAusente(c: Contexto): Nota {
  const lugares = new Map<string, number>();
  c.lotes
    .filter((l) => l.cv === c.cv)
    .forEach((l) => {
      const lugar = `${c.plantas.find((p) => p.id === l.planta_id)?.nombre ?? "?"} / ${c.productos.find((p) => p.id === l.producto_id)?.nombre ?? "?"}`;
      lugares.set(lugar, (lugares.get(lugar) ?? 0) + l.tn);
    });
  const donde = Array.from(lugares.entries()).map(([l, tn]) => `${l} (${fmtTn(tn)} tn)`).join(", ");
  return {
    tipo: "aviso",
    texto: donde
      ? `El ${c.cv} no tiene mercadería en esta planta/producto. Está en: ${donde}. Revisá el CV o la planta.`
      : `El ${c.cv} no tiene mercadería asignada en el stock. Revisá el número.`,
  };
}

// Sugerencia de productor para un egreso. Orden: el CV (dueño de la
// mercadería de ese CV en la planta), el nombre de la planta o del titular
// de la CP, el único productor con stock ahí. Si no se puede, se lista.
function sugerirProductor(c: Contexto & { pistas: Pista[] }): { id: string; notas: Nota[] } {
  const aca = deAca(c);
  const que = c.productoId ? "de este producto " : "";
  const notas: Nota[] = [];

  if (c.cv) {
    const duenos = productoresDe(aca.filter((l) => l.cv === c.cv), c.productores);
    if (duenos.length === 1) {
      return {
        id: duenos[0].id,
        notas: [{ tipo: "ok", texto: `Elegido solo: la mercadería del ${c.cv} en esta planta es de ${duenos[0].nombre} (${fmtTn(duenos[0].tn)} tn).` }],
      };
    }
    if (duenos.length > 1) {
      for (const pista of c.pistas) {
        const p = buscarEnCatalogo(pista.nombre, duenos) as (Catalogo & { tn: number }) | null;
        if (p) {
          return {
            id: p.id,
            notas: [{ tipo: "ok", texto: `Elegido solo: ${p.nombre} coincide con ${pista.de} y tiene ${fmtTn(p.tn)} tn del ${c.cv}.` }],
          };
        }
      }
      return { id: "", notas: [{ tipo: "aviso", texto: `El ${c.cv} tiene mercadería de varios productores: ${listar(duenos)}. Elegí de quién sale.` }] };
    }
    notas.push(avisoCvAusente(c));
  }

  const conStock = productoresDe(aca, c.productores);
  for (const pista of c.pistas) {
    const p = buscarEnCatalogo(pista.nombre, conStock) as (Catalogo & { tn: number }) | null;
    if (p) {
      notas.push({ tipo: "ok", texto: `Elegido solo: ${p.nombre} coincide con ${pista.de} y tiene ${fmtTn(p.tn)} tn ${que}acá.` });
      return { id: p.id, notas };
    }
  }
  if (conStock.length === 1) {
    notas.push({ tipo: "ok", texto: `Elegido solo: ${conStock[0].nombre} es el único con stock ${que}en esta planta (${fmtTn(conStock[0].tn)} tn).` });
    return { id: conStock[0].id, notas };
  }
  notas.push(
    conStock.length === 0
      ? { tipo: "aviso", texto: `No hay stock ${que}cargado a nombre de ningún productor en esta planta.` }
      : { tipo: "aviso", texto: `Hay stock ${que}de varios productores: ${listar(conStock)}. Elegí de quién sale.` }
  );
  return { id: "", notas };
}

// Revisión del productor elegido a mano: cuánto tiene y si coincide con el CV
function revisarElegido(c: Contexto & { productorId: string }): Nota[] {
  const elegido = c.productores.find((p) => p.id === c.productorId);
  if (!elegido) return c.cv && !deAca(c).some((l) => l.cv === c.cv) ? [avisoCvAusente(c)] : [];
  const notas: Nota[] = [];
  if (c.cv) {
    const duenos = productoresDe(deAca(c).filter((l) => l.cv === c.cv), c.productores);
    if (duenos.length === 0) notas.push(avisoCvAusente(c));
    else if (!duenos.some((d) => d.id === elegido.id)) {
      notas.push({
        tipo: "aviso",
        texto: `El ${c.cv} es de ${duenos.map((d) => d.nombre).join(" y ")} y elegiste ${elegido.nombre}. Revisalo.`,
      });
    }
  }
  const tn = stockDe(c.lotes, c.plantaId, c.productoId, elegido.id);
  notas.push(
    tn > 0.0005
      ? { tipo: "ok", texto: `${elegido.nombre} tiene ${fmtTn(tn)} tn ${c.productoId ? "de este producto " : ""}en esta planta.` }
      : { tipo: "aviso", texto: `${elegido.nombre} no tiene stock ${c.productoId ? "de este producto " : ""}en esta planta. Revisalo.` }
  );
  return notas;
}

export default function MovimientoForm({
  plantas,
  productos,
  productores,
  stock = [],
  lotesStock = [],
}: {
  plantas: Catalogo[];
  productos: Catalogo[];
  productores: Catalogo[];
  stock?: { planta_id: string; producto_id: string; tn: number }[];
  // Stock actual de cada lote con su productor: para sugerir el productor de un egreso
  lotesStock?: LoteConProductor[];
}) {
  const [tipo, setTipo] = useState<Tipo>("ingreso");
  const [mensaje, setMensaje] = useState<
    { tipo: "ok" | "error"; texto: string } | null
  >(null);
  const [enviando, setEnviando] = useState(false);

  const hoy = new Date().toISOString().slice(0, 10);

  // Campos que se pueden autocompletar leyendo el PDF de la Carta de Porte.
  // Quedan editables: leer la CP solo ahorra tipeo, la persona sigue
  // pudiendo corregir cualquier valor antes de guardar.
  const [numeroCp, setNumeroCp] = useState("");
  const [transportista, setTransportista] = useState("");
  const [chofer, setChofer] = useState("");
  const [patente, setPatente] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [cantidadDescargada, setCantidadDescargada] = useState("");
  // Bolsas (se leen de "Observaciones" de la CP)
  const [bolsas, setBolsas] = useState({ b25: "", b50: "", bb: "" });
  const [notaBolsas, setNotaBolsas] = useState<{ tipo: "ok" | "aviso"; texto: string } | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [destino, setDestino] = useState("");
  const [titular, setTitular] = useState("");
  const [productor, setProductor] = useState("");
  const [productoId, setProductoId] = useState("");
  const [plantaId, setPlantaId] = useState("");
  const [productorId, setProductorId] = useState("");
  // Egreso: por qué se eligió (o no) el productor solo, y si la persona lo cambió a mano
  const [notasProductor, setNotasProductor] = useState<Nota[]>([]);
  // CV del egreso: se revisa al salir del campo (no mientras se escribe)
  const [cvTexto, setCvTexto] = useState("");
  const [cvEgreso, setCvEgreso] = useState<string | null>(null);
  // CP que ya está cargada como el mismo tipo de movimiento
  const [cpRepetida, setCpRepetida] = useState<CpCargada[]>([]);
  const productorAMano = useRef(false);
  // Catálogos locales: si desde la CP se agrega una planta o un productor
  // nuevo, aparece en la lista sin recargar la página.
  const [listaPlantas, setListaPlantas] = useState<Catalogo[]>(plantas);
  const [listaProductores, setListaProductores] = useState<Catalogo[]>(productores);
  // Emisor de la CP que no está en el catálogo: se ofrece agregarlo.
  const [paraAgregar, setParaAgregar] = useState<{ tabla: "plantas" | "productores"; nombre: string } | null>(null);
  const [agregando, setAgregando] = useState(false);
  // Últimos datos leídos de una CP, para poder recalcular los campos que
  // dependen del tipo (cantidad, fecha, destino, producto...) cuando la
  // persona cambia de pestaña después de leerla, sin tener que volver a
  // subir el mismo PDF.
  const [datosCp, setDatosCp] = useState<DatosCp | null>(null);
  const [leyendoCp, setLeyendoCp] = useState(false);
  const [mensajeCp, setMensajeCp] = useState<
    { tipo: "ok" | "error"; texto: string } | null
  >(null);
  const inputCpRef = useRef<HTMLInputElement>(null);

  function limpiarCamposCp() {
    setNumeroCp("");
    setTransportista("");
    setChofer("");
    setPatente("");
    setCantidad("");
    setCantidadDescargada("");
    setBolsas({ b25: "", b50: "", bb: "" });
    setNotaBolsas(null);
    setFecha(hoy);
    setDestino("");
    setTitular("");
    setProductor("");
    setProductoId("");
    setPlantaId("");
    setProductorId("");
    productorAMano.current = false;
    setNotasProductor([]);
    setParaAgregar(null);
    setDatosCp(null);
    setMensajeCp(null);
    if (inputCpRef.current) inputCpRef.current.value = "";
  }

  // Aplica los datos ya leídos de una CP a los campos del formulario,
  // según el tipo de movimiento actual. Se llama tanto al leer el PDF
  // como cada vez que se cambia de pestaña (Ingreso/Egreso/Directo) con
  // una CP ya leída, para no tener que volver a subir el mismo archivo:
  // el peso, la fecha y el resto dependen del tipo, así que hay que
  // recalcularlos.
  function aplicarDatosCp(datos: DatosCp, tipoActual: Tipo) {
    {
      const neto = tipoActual === "ingreso" ? datos.pesoNetoDescargaKg ?? datos.pesoNetoCargaKg : datos.pesoNetoCargaKg;
      const lb = leerBolsas(datos.observaciones, neto);
      setBolsas({ b25: lb.bolsas_25 ? String(lb.bolsas_25) : "", b50: lb.bolsas_50 ? String(lb.bolsas_50) : "", bb: lb.big_bags ? String(lb.big_bags) : "" });
      setNotaBolsas(
        lb.aviso
          ? { tipo: "aviso", texto: lb.aviso }
          : lb.leido
          ? { tipo: "ok", texto: `Leído de las observaciones de la CP${lb.detalle ? `: ${lb.detalle}` : ""}. Revisalo.` }
          : datos.observaciones
          ? { tipo: "aviso", texto: `No encontré bolsas en las observaciones ("${datos.observaciones}"). Si salió embolsado, completalo a mano.` }
          : null
      );
    }
    const faltantes: string[] = [];

    // El producto se intenta asociar leyendo el grano/tipo de poroto de la
    // CP, en los tres tipos de movimiento (antes solo se hacía en
    // Directo). Sigue siendo un desplegable editable: si no matchea bien,
    // se elige a mano antes de guardar.

    if (datos.numeroCpe) setNumeroCp(datos.numeroCpe);
    if (datos.transportista) setTransportista(datos.transportista);
    else faltantes.push("transportista");
    if (datos.chofer) setChofer(datos.chofer);
    else faltantes.push("chofer");
    if (datos.patente) setPatente(datos.patente);
    else faltantes.push("patente");

    // Ingreso toma el peso descargado (lo que efectivamente entró);
    // egreso toma el peso cargado (el que figura siempre en la sección B
    // de la CP, no depende de que ya se haya descargado). Directo
    // muestra los dos, para poder ver si hubo diferencia en el camino
    // aunque la mercadería nunca haya pasado por el depósito propio.
    if (tipoActual === "directo") {
      if (datos.pesoNetoCargaKg) {
        setCantidad((datos.pesoNetoCargaKg / 1000).toFixed(3));
      } else {
        faltantes.push("peso neto de carga");
      }
      setCantidadDescargada(
        datos.pesoNetoDescargaKg ? (datos.pesoNetoDescargaKg / 1000).toFixed(3) : ""
      );
    } else {
      const pesoKg = tipoActual === "ingreso" ? datos.pesoNetoDescargaKg : datos.pesoNetoCargaKg;
      if (pesoKg) {
        setCantidad((pesoKg / 1000).toFixed(3));
      } else {
        setCantidad("");
        faltantes.push(
          tipoActual === "ingreso"
            ? "peso neto de descarga (la CP todavía no tiene la descarga cargada)"
            : "peso neto de carga"
        );
      }
    }

    // Fecha: el ingreso toma la de descarga y el egreso la de partida; si
    // la CP no la tiene, la de emisión (arriba a la derecha).
    const fechaTipo =
      tipoActual === "ingreso" ? datos.fechaDescarga : tipoActual === "egreso" ? datos.fechaPartida : null;
    if (fechaTipo) setFecha(fechaTipo);
    else if (datos.fecha) setFecha(datos.fecha);

    // Emisor de la CP (Titular): en un ingreso es el productor; en un
    // egreso, la planta de donde sale. Si no está en el catálogo, se
    // ofrece agregarlo.
    setParaAgregar(null);
    const emisor = conAlias(datos.titular);
    let plantaElegida: string | null = null;
    if (tipoActual === "ingreso") {
      const prod = buscarEnCatalogo(emisor, listaProductores);
      if (prod) setProductorId(prod.id);
      else {
        setProductorId("");
        if (emisor) setParaAgregar({ tabla: "productores", nombre: emisor });
        else faltantes.push("titular (productor)");
      }
      // La planta del ingreso es el destino de la CP, si coincide con una del catálogo
      const planta = buscarEnCatalogo(conAlias(datos.destinoNombre), listaPlantas);
      if (planta) {
        setPlantaId(planta.id);
        plantaElegida = planta.id;
      }
    } else if (tipoActual === "egreso") {
      const planta = buscarEnCatalogo(emisor, listaPlantas);
      if (planta) {
        setPlantaId(planta.id);
        plantaElegida = planta.id;
      } else {
        setPlantaId("");
        if (emisor) setParaAgregar({ tabla: "plantas", nombre: emisor });
        else faltantes.push("titular (planta)");
      }
    }

    // Producto: se asocia leyendo "Grano / especie" y "Tipo" de la CP.
    // Colorado no dice si es Dark o Light: en un egreso se elige el que
    // tiene stock en esa planta (si hay uno solo); si no, se elige a mano.
    let productoDetectado = detectarProductoId(datos.granoTipo, productos);
    const esColorado = /colorado/i.test(datos.granoTipo ?? "");
    if (!productoDetectado && esColorado && plantaElegida) {
      const conStock = productos.filter(
        (p) =>
          /colorado/i.test(p.nombre) &&
          !/^descarte/i.test(p.nombre.trim()) &&
          stock.some((x) => x.planta_id === plantaElegida && x.producto_id === p.id && x.tn > 0)
      );
      if (conStock.length === 1) productoDetectado = conStock[0].id;
    }
    if (productoDetectado) {
      setProductoId(productoDetectado);
    } else {
      setProductoId("");
      faltantes.push(
        esColorado
          ? "producto (la CP dice Colorado: elegí Dark o Light)"
          : datos.granoTipo
          ? `producto (la CP dice "${datos.granoTipo}", elegilo a mano)`
          : "producto"
      );
    }

    if (tipoActual === "egreso" || tipoActual === "directo") {
      if (datos.destino) setDestino(datos.destino);
      else faltantes.push("destino");
    } else {
      setDestino("");
    }
    if (tipoActual === "directo") {
      if (datos.titular) setTitular(datos.titular);
      else faltantes.push("titular");
      if (datos.productor) setProductor(datos.productor);
      else faltantes.push("productor");
    } else {
      setTitular("");
      setProductor("");
    }

    if (faltantes.length > 0) {
      setMensajeCp({
        tipo: "error",
        texto: `Se completó lo que se pudo leer, pero faltó en el PDF: ${faltantes.join(", ")}. Completalo a mano.`,
      });
    } else {
      setMensajeCp({ tipo: "ok", texto: "Datos de la CP cargados. Revisalos antes de guardar." });
    }
  }

  // Si ya hay una CP leída y se cambia de pestaña, recalcula los campos
  // para el tipo nuevo sin pedir que se vuelva a subir el PDF.
  useEffect(() => {
    if (datosCp) aplicarDatosCp(datosCp, tipo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  // Egreso: el productor sale del stock. Si la planta o el titular de la CP
  // se llaman igual que un productor con stock ahí (CAÑADA HUMEDA ->
  // CAÑADA HUMEDA), se elige ese; si hay un solo productor con stock de ese
  // producto en la planta, ese. Si hay varios, se avisa cuáles y se elige a mano.
  useEffect(() => {
    if (tipo !== "egreso" || !plantaId) {
      setNotasProductor([]);
      return;
    }
    const contexto: Contexto = {
      plantaId,
      productoId,
      cv: cvEgreso,
      lotes: lotesStock,
      productores: listaProductores,
      plantas: listaPlantas,
      productos,
    };
    if (productorAMano.current) {
      setNotasProductor(revisarElegido({ ...contexto, productorId }));
      return;
    }
    const nombrePlanta = listaPlantas.find((p) => p.id === plantaId)?.nombre ?? null;
    const r = sugerirProductor({
      ...contexto,
      pistas: [
        { nombre: nombrePlanta, de: "la planta" },
        { nombre: conAlias(datosCp?.titular), de: "el titular de la CP" },
        { nombre: datosCp?.productor ?? null, de: "el remitente productor de la CP" },
      ],
    });
    setProductorId(r.id);
    setNotasProductor(r.notas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, plantaId, productoId, datosCp, cvEgreso]);

  useEffect(() => {
    setCpRepetida([]);
    if (numeroCp.replace(/\D/g, "").length < 6) return;
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await buscarCpCargada(numeroCp, tipo as "ingreso" | "egreso" | "directo");
        if (vigente) setCpRepetida(r);
      } catch {
        // sin conexión: no se avisa, no bloquea la carga
      }
    }, 400);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [numeroCp, tipo]);

  async function handleLeerCp(archivo: File, tipoActual: Tipo) {
    setLeyendoCp(true);
    setMensajeCp(null);
    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      const res = await fetch("/api/cp/parse", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setMensajeCp({ tipo: "error", texto: json.error ?? "No se pudo leer la CP." });
        return;
      }

      const datos = json.datos as DatosCp;
      productorAMano.current = false;
      setDatosCp(datos);
      aplicarDatosCp(datos, tipoActual);
    } catch (e) {
      setMensajeCp({ tipo: "error", texto: `No se pudo leer el PDF: ${(e as Error).message}` });
    } finally {
      setLeyendoCp(false);
    }
  }

  // Si la CP dice Colorado y se elige la planta a mano en un egreso, se
  // completa el producto con el colorado que tiene stock en esa planta.
  useEffect(() => {
    if (tipo !== "egreso" || productoId || !plantaId || !/colorado/i.test(datosCp?.granoTipo ?? "")) return;
    const conStock = productos.filter(
      (p) =>
        /colorado/i.test(p.nombre) &&
        !/^descarte/i.test(p.nombre.trim()) &&
        stock.some((x) => x.planta_id === plantaId && x.producto_id === p.id && x.tn > 0)
    );
    if (conStock.length === 1) setProductoId(conStock[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantaId]);

  async function agregarDesdeCp() {
    if (!paraAgregar) return;
    setAgregando(true);
    const r = await crearDesdeCp(paraAgregar.tabla, paraAgregar.nombre);
    setAgregando(false);
    if (!r.ok) {
      setMensajeCp({ tipo: "error", texto: r.error });
      return;
    }
    const nuevo = { id: r.id, nombre: r.nombre };
    if (paraAgregar.tabla === "productores") {
      setListaProductores((l) => (l.some((x) => x.id === nuevo.id) ? l : [...l, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre))));
      setProductorId(nuevo.id);
    } else {
      setListaPlantas((l) => (l.some((x) => x.id === nuevo.id) ? l : [...l, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre))));
      setPlantaId(nuevo.id);
    }
    setParaAgregar(null);
  }

  // Alta a mano de un productor o una planta que no está en la lista
  // (por ejemplo cuando la CP no se pudo leer).
  const [nuevoNombre, setNuevoNombre] = useState<{ tabla: "plantas" | "productores"; nombre: string } | null>(null);
  async function agregarManual() {
    if (!nuevoNombre || !nuevoNombre.nombre.trim()) return;
    setAgregando(true);
    const r = await crearDesdeCp(nuevoNombre.tabla, nuevoNombre.nombre.trim());
    setAgregando(false);
    if (!r.ok) {
      setMensajeCp({ tipo: "error", texto: r.error });
      return;
    }
    const nuevo = { id: r.id, nombre: r.nombre };
    const orden = (l: Catalogo[]) =>
      l.some((x) => x.id === nuevo.id) ? l : [...l, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (nuevoNombre.tabla === "productores") {
      setListaProductores(orden);
      setProductorId(nuevo.id);
    } else {
      setListaPlantas(orden);
      setPlantaId(nuevo.id);
    }
    setNuevoNombre(null);
  }
  function AgregarManual({ tabla }: { tabla: "plantas" | "productores" }) {
    const etiqueta = tabla === "plantas" ? "planta" : "productor";
    if (!nuevoNombre || nuevoNombre.tabla !== tabla) {
      return (
        <button
          type="button"
          onClick={() => setNuevoNombre({ tabla, nombre: "" })}
          className="mt-1 text-xs text-brand-green hover:underline"
        >
          + ¿No está en la lista? Agregar {etiqueta}
        </button>
      );
    }
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <input
          autoFocus
          value={nuevoNombre.nombre}
          onChange={(e) => setNuevoNombre({ tabla, nombre: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              agregarManual();
            }
          }}
          placeholder={`Nombre del ${etiqueta}`}
          className="border border-gray-300 rounded px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={agregando || !nuevoNombre.nombre.trim()}
          onClick={agregarManual}
          className="rounded bg-brand-navy text-white px-2 py-1 disabled:opacity-50"
        >
          {agregando ? "Agregando…" : "Agregar"}
        </button>
        <button type="button" onClick={() => setNuevoNombre(null)} className="text-gray-500 hover:underline">
          Cancelar
        </button>
      </div>
    );
  }

  function AvisoAgregar({ tabla }: { tabla: "plantas" | "productores" }) {
    if (!paraAgregar || paraAgregar.tabla !== tabla) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5">
        <span>
          «{paraAgregar.nombre}» (emisor de la CP) no está en {tabla === "plantas" ? "las plantas" : "los productores"}.
        </span>
        <button
          type="button"
          disabled={agregando}
          onClick={agregarDesdeCp}
          className="rounded bg-brand-navy text-white px-2 py-0.5 disabled:opacity-50"
        >
          {agregando ? "Agregando…" : tabla === "plantas" ? "Agregar como planta" : "Agregar como productor"}
        </button>
      </div>
    );
  }

  // Ingreso: diferencia entre los kg cargados (origen) y descargados (destino) de la CP
  const kgCarga = datosCp?.pesoNetoCargaKg ?? null;
  const kgDescarga = datosCp?.pesoNetoDescargaKg ?? null;
  const difKg = kgCarga && kgDescarga ? kgCarga - kgDescarga : 0;
  const avisoBalanzaIngreso =
    tipo === "ingreso" && Math.abs(difKg) > TOLERANCIA_INGRESO_KG
      ? `La CP dice ${kgCarga!.toLocaleString("es-AR")} kg cargados y ${kgDescarga!.toLocaleString("es-AR")} kg descargados: llegaron ${Math.abs(difKg).toLocaleString("es-AR")} kg ${difKg > 0 ? "menos" : "más"}. Revisalo.`
      : null;

  // Egreso: si sale un poco más de lo que hay (diferencia de balanza) se deja
  // cargar y se descuenta todo el stock; si es mucho más, no.
  const disponiblePlanta = stock.find((x) => x.planta_id === plantaId && x.producto_id === productoId)?.tn ?? null;
  const tnEgreso = Number(cantidad);
  const excesoKg = disponiblePlanta !== null && tnEgreso > 0 ? Math.round((tnEgreso - disponiblePlanta) * 1000) : 0;
  const avisoStockEgreso: { tipo: "aviso" | "error"; texto: string } | null =
    tipo !== "egreso" || excesoKg <= 0
      ? null
      : excesoKg <= TOLERANCIA_EGRESO_KG
      ? {
          tipo: "aviso",
          texto: `En stock hay ${fmtTn(disponiblePlanta!)} tn y la CP dice ${fmtTn(tnEgreso)} tn: ${excesoKg} kg de diferencia de balanza. Se puede cargar: se descuenta todo el stock y queda en 0.`,
        }
      : {
          tipo: "error",
          texto: `En stock hay ${fmtTn(disponiblePlanta!)} tn: la CP supera el stock por ${excesoKg.toLocaleString("es-AR")} kg (más de ${TOLERANCIA_EGRESO_KG} kg). Revisá la planta, el producto o los ingresos.`,
        };

  async function handleSubmit(formData: FormData) {
    setEnviando(true);
    setMensaje(null);

    const resultado =
      tipo === "ingreso"
        ? await crearIngreso(formData)
        : tipo === "egreso"
        ? await crearEgreso(formData)
        : await crearMovimientoDirecto(formData);

    setEnviando(false);

    if (resultado.ok) {
      setMensaje({ tipo: "ok", texto: "Movimiento cargado correctamente." });
      (document.getElementById("form-movimiento") as HTMLFormElement)?.reset();
      limpiarCamposCp();
      setCvTexto("");
      setCvEgreso(null);
    } else {
      setMensaje({ tipo: "error", texto: resultado.error });
    }
  }

  function CampoCp() {
    return (
      <div className="border border-dashed border-gray-300 rounded-md p-3 bg-gray-50">
        <label className="block text-sm text-gray-600 mb-1">
          Cargar Carta de Porte (PDF, opcional)
        </label>
        <input
          ref={inputCpRef}
          type="file"
          accept="application/pdf"
          disabled={leyendoCp}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            if (archivo) {
              handleLeerCp(archivo, tipo);
            }
          }}
          className="text-sm"
        />
        {leyendoCp && <p className="text-xs text-gray-500 mt-1">Leyendo PDF…</p>}
        {mensajeCp && (
          <p
            className={`text-xs mt-1 ${
              mensajeCp.tipo === "ok" ? "text-green-700" : "text-amber-700"
            }`}
          >
            {mensajeCp.texto}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-6">
        {([
          { valor: "ingreso" as const, etiqueta: "Ingreso" },
          { valor: "egreso" as const, etiqueta: "Egreso" },
        ]).map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => setTipo(t.valor)}
            className={`px-3 py-1.5 rounded text-sm ${
              tipo === t.valor
                ? "bg-brand-navy text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      <form id="form-movimiento" action={handleSubmit} className="space-y-4">
        <input type="hidden" name="tipo" value={tipo} />

        {tipo === "ingreso" ? (
          <>
            <CampoCp />

            <Campo label="Planta">
              <select name="planta_id" required className="input" value={plantaId} onChange={(e) => setPlantaId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {listaPlantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Producto">
              <select
                name="producto_id"
                required
                className="input"
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Productor">
              <select name="productor_id" required className="input" value={productorId} onChange={(e) => setProductorId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {listaProductores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <AvisoAgregar tabla="productores" />
              {AgregarManual({ tabla: "productores" })}
            </Campo>

            <Campo label="Estado">
              <select name="estado" defaultValue="natural" className="input">
                <option value="natural">Natural</option>
                <option value="procesado">Procesado</option>
              </select>
            </Campo>

            <Campo label="Número de CP">
              <input
                name="numero_cp"
                className="input"
                value={numeroCp}
                onChange={(e) => setNumeroCp(e.target.value)}
              />
              {cpRepetida.length > 0 && (
                <div className="text-xs mt-1 rounded border border-amber-200 bg-amber-50 text-amber-800 px-2 py-1.5">
                  Esta CP ya está cargada:{" "}
                  {cpRepetida
                    .map(
                      (c) =>
                        [
                          c.fecha ? c.fecha.split("-").reverse().join("/") : null,
                          listaPlantas.find((p) => p.id === c.planta_id)?.nombre,
                          productos.find((p) => p.id === c.producto_id)?.nombre,
                          c.tn ? `${fmtTn(c.tn)} tn` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                    )
                    .join(" · ")}
                  .
                  <label className="flex items-center gap-1.5 mt-1 font-medium">
                    <input type="checkbox" required /> Es otra carga, guardar igual
                  </label>
                </div>
              )}
            </Campo>

            <Campo label="Transportista">
              <input
                name="transportista"
                className="input"
                value={transportista}
                onChange={(e) => setTransportista(e.target.value)}
              />
            </Campo>

            <Campo label="Chofer">
              <input
                name="chofer"
                className="input"
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
              />
            </Campo>

            <Campo label="Patente">
              <input
                name="patente"
                className="input"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
              />
            </Campo>

            <Campo label="Quién controló la carga">
              <input name="controlo_carga" className="input" placeholder="Nombre de quien estuvo en la carga" />
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              {avisoBalanzaIngreso && (
                <p className="text-xs mt-1 text-amber-700">{avisoBalanzaIngreso}</p>
              )}
            </Campo>
            <Campo label="Bolsas (si va embolsado)">
              <div className="grid grid-cols-3 gap-2">
                <input name="bolsas_25" type="number" min="0" step="1" className="input" placeholder="de 25 kg" value={bolsas.b25} onChange={(e) => setBolsas({ ...bolsas, b25: e.target.value })} />
                <input name="bolsas_50" type="number" min="0" step="1" className="input" placeholder="de 50 kg" value={bolsas.b50} onChange={(e) => setBolsas({ ...bolsas, b50: e.target.value })} />
                <input name="big_bags" type="number" min="0" step="1" className="input" placeholder="big bags" value={bolsas.bb} onChange={(e) => setBolsas({ ...bolsas, bb: e.target.value })} />
              </div>
              {notaBolsas && (
                <p className={`text-xs mt-1 ${notaBolsas.tipo === "ok" ? "text-green-700" : "text-amber-700"}`}>{notaBolsas.texto}</p>
              )}
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                required
                className="input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
          </>
        ) : tipo === "egreso" ? (
          <>
            <CampoCp />

            <Campo label="Planta (de dónde sale)">
              <select name="planta_id" required className="input" value={plantaId} onChange={(e) => setPlantaId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {listaPlantas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <AvisoAgregar tabla="plantas" />
              {AgregarManual({ tabla: "plantas" })}
            </Campo>

            <Campo label="Producto">
              <select
                name="producto_id"
                required
                className="input"
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="CV (si la salida es para una operación; baja lo comprometido)">
              <input
                name="cv"
                className="input"
                placeholder="Ej.: 26-124"
                value={cvTexto}
                onChange={(e) => setCvTexto(e.target.value)}
                onBlur={() => setCvEgreso(normalizarCv(cvTexto))}
              />
            </Campo>

            <Campo label="Productor (sale del stock de la planta)">
              <select
                name="productor_id"
                className="input"
                value={productorId}
                onChange={(e) => {
                  productorAMano.current = true;
                  setProductorId(e.target.value);
                  setNotasProductor(
                    revisarElegido({
                      plantaId,
                      productoId,
                      cv: cvEgreso,
                      lotes: lotesStock,
                      productores: listaProductores,
                      plantas: listaPlantas,
                      productos,
                      productorId: e.target.value,
                    })
                  );
                }}
              >
                <option value="">No especificar</option>
                {listaProductores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              {notasProductor.map((n, i) => (
                <p key={i} className={`text-xs mt-1 ${n.tipo === "ok" ? "text-green-700" : "text-amber-700"}`}>
                  {n.texto}
                </p>
              ))}
            </Campo>

            <Campo label="Número de CP">
              <input
                name="numero_cp"
                className="input"
                value={numeroCp}
                onChange={(e) => setNumeroCp(e.target.value)}
              />
              {cpRepetida.length > 0 && (
                <div className="text-xs mt-1 rounded border border-amber-200 bg-amber-50 text-amber-800 px-2 py-1.5">
                  Esta CP ya está cargada:{" "}
                  {cpRepetida
                    .map(
                      (c) =>
                        [
                          c.fecha ? c.fecha.split("-").reverse().join("/") : null,
                          listaPlantas.find((p) => p.id === c.planta_id)?.nombre,
                          productos.find((p) => p.id === c.producto_id)?.nombre,
                          c.tn ? `${fmtTn(c.tn)} tn` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                    )
                    .join(" · ")}
                  .
                  <label className="flex items-center gap-1.5 mt-1 font-medium">
                    <input type="checkbox" required /> Es otra carga, guardar igual
                  </label>
                </div>
              )}
            </Campo>

            <Campo label="Transportista">
              <input
                name="transportista"
                className="input"
                value={transportista}
                onChange={(e) => setTransportista(e.target.value)}
              />
            </Campo>

            <Campo label="Chofer">
              <input
                name="chofer"
                className="input"
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
              />
            </Campo>

            <Campo label="Patente">
              <input
                name="patente"
                className="input"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
              />
            </Campo>

            <Campo label="Quién controló la carga">
              <input name="controlo_carga" className="input" placeholder="Nombre de quien estuvo en la carga" />
            </Campo>

            <Campo label="Destino (a dónde va, según la CP)">
              <input
                name="destino"
                className="input"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
            </Campo>

            <Campo label="Cantidad (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              {avisoStockEgreso && (
                <p className={`text-xs mt-1 ${avisoStockEgreso.tipo === "error" ? "text-red-600" : "text-amber-700"}`}>
                  {avisoStockEgreso.texto}
                </p>
              )}
            </Campo>
            <Campo label="Bolsas (si va embolsado)">
              <div className="grid grid-cols-3 gap-2">
                <input name="bolsas_25" type="number" min="0" step="1" className="input" placeholder="de 25 kg" value={bolsas.b25} onChange={(e) => setBolsas({ ...bolsas, b25: e.target.value })} />
                <input name="bolsas_50" type="number" min="0" step="1" className="input" placeholder="de 50 kg" value={bolsas.b50} onChange={(e) => setBolsas({ ...bolsas, b50: e.target.value })} />
                <input name="big_bags" type="number" min="0" step="1" className="input" placeholder="big bags" value={bolsas.bb} onChange={(e) => setBolsas({ ...bolsas, bb: e.target.value })} />
              </div>
              {notaBolsas && (
                <p className={`text-xs mt-1 ${notaBolsas.tipo === "ok" ? "text-green-700" : "text-amber-700"}`}>{notaBolsas.texto}</p>
              )}
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                required
                className="input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
          </>
        ) : (
          <>
            <CampoCp />

            <Campo label="Producto">
              <select
                name="producto_id"
                required
                className="input"
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo label="Titular de la CP">
              <input
                name="titular"
                className="input"
                value={titular}
                onChange={(e) => setTitular(e.target.value)}
              />
            </Campo>

            <Campo label="Productor / remitente">
              <input
                name="productor_texto"
                className="input"
                value={productor}
                onChange={(e) => setProductor(e.target.value)}
              />
            </Campo>

            <Campo label="Destino">
              <input
                name="destino"
                className="input"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
            </Campo>

            <Campo label="Número de CP">
              <input
                name="numero_cp"
                className="input"
                value={numeroCp}
                onChange={(e) => setNumeroCp(e.target.value)}
              />
              {cpRepetida.length > 0 && (
                <div className="text-xs mt-1 rounded border border-amber-200 bg-amber-50 text-amber-800 px-2 py-1.5">
                  Esta CP ya está cargada:{" "}
                  {cpRepetida
                    .map(
                      (c) =>
                        [
                          c.fecha ? c.fecha.split("-").reverse().join("/") : null,
                          listaPlantas.find((p) => p.id === c.planta_id)?.nombre,
                          productos.find((p) => p.id === c.producto_id)?.nombre,
                          c.tn ? `${fmtTn(c.tn)} tn` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")
                    )
                    .join(" · ")}
                  .
                  <label className="flex items-center gap-1.5 mt-1 font-medium">
                    <input type="checkbox" required /> Es otra carga, guardar igual
                  </label>
                </div>
              )}
            </Campo>

            <Campo label="Transportista">
              <input
                name="transportista"
                className="input"
                value={transportista}
                onChange={(e) => setTransportista(e.target.value)}
              />
            </Campo>

            <Campo label="Chofer">
              <input
                name="chofer"
                className="input"
                value={chofer}
                onChange={(e) => setChofer(e.target.value)}
              />
            </Campo>

            <Campo label="Patente">
              <input
                name="patente"
                className="input"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
              />
            </Campo>

            <Campo label="Quién controló la carga">
              <input name="controlo_carga" className="input" placeholder="Nombre de quien estuvo en la carga" />
            </Campo>

            <Campo label="Cantidad cargada (toneladas)">
              <input
                name="cantidad"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="input"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Campo>
            <Campo label="Bolsas (si va embolsado)">
              <div className="grid grid-cols-3 gap-2">
                <input name="bolsas_25" type="number" min="0" step="1" className="input" placeholder="de 25 kg" value={bolsas.b25} onChange={(e) => setBolsas({ ...bolsas, b25: e.target.value })} />
                <input name="bolsas_50" type="number" min="0" step="1" className="input" placeholder="de 50 kg" value={bolsas.b50} onChange={(e) => setBolsas({ ...bolsas, b50: e.target.value })} />
                <input name="big_bags" type="number" min="0" step="1" className="input" placeholder="big bags" value={bolsas.bb} onChange={(e) => setBolsas({ ...bolsas, bb: e.target.value })} />
              </div>
              {notaBolsas && (
                <p className={`text-xs mt-1 ${notaBolsas.tipo === "ok" ? "text-green-700" : "text-amber-700"}`}>{notaBolsas.texto}</p>
              )}
            </Campo>

            <Campo label="Cantidad descargada (toneladas, opcional)">
              <input
                name="cantidad_descargada"
                type="number"
                step="0.001"
                min="0.001"
                className="input"
                value={cantidadDescargada}
                onChange={(e) => setCantidadDescargada(e.target.value)}
              />
            </Campo>

            <Campo label="Fecha">
              <input
                name="fecha"
                type="date"
                required
                className="input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
          </>
        )}

        <Campo label="Observaciones">
          <textarea name="observaciones" className="input" rows={2} />
        </Campo>

        {mensaje && (
          <p
            className={
              mensaje.tipo === "ok" ? "text-green-700 text-sm" : "text-red-600 text-sm"
            }
          >
            {mensaje.texto}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="bg-brand-green hover:bg-brand-green-dark text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {enviando ? "Guardando…" : "Guardar movimiento"}
        </button>
      </form>

      <style jsx global>{`
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
