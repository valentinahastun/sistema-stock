// Los pasos de una operación, en orden. Las reglas de "aplica" tienen que
// coincidir con las de las alertas en supabase/0001_tracking.sql.

export type Operacion = {
  clave: string;
  cv: string;
  lote: string | null;
  cliente: string | null;
  broker: string | null;
  silver: boolean;
  destino: string | null;
  producto: string | null;
  tn: number | null;
  responsable: "lourdes" | "valentina" | null;
  payment_terms: string | null;
  fecha_contrato: string | null;
  tipo_bl: string | null;
  booking: string | null;
  contenedores: string | null;
  fecha_carga_planta: string | null;
  fecha_consolidado: string | null;
  corte_documental: string | null;
  lugar_carga: string | null;
  deposito: string | null;
  carpeta_url?: string | null;
  etd: string | null;
  eta: string | null;
  activa: boolean;
};

export type Hito = {
  clave: string;
  paso: string;
  fecha: string | null;
  fuente: string;
  detalle: string | null;
  mail_url: string | null;
  updated_by: string | null;
};

export type Alerta = {
  clave: string;
  cv: string;
  lote: string | null;
  cliente: string | null;
  destino: string | null;
  responsable: string | null;
  paso: string;
  nivel: "vencida" | "proxima";
  mensaje: string;
  fecha_limite: string | null;
  en_mail: boolean;
};

export type Paso = { codigo: string; nombre: string; ayuda?: string };

export const conAnticipo = (o: Operacion) =>
  /(anticip|advance|adelant|previo)/i.test(o.payment_terms ?? "");

export const pideIp = (o: Operacion) =>
  /(pakist|karachi|filipin|manila|venezuel|cabello|colombia|buenaventura|cartagena)/i.test(o.destino ?? "");

export const esCopyDocs = (o: Operacion) => /cop/i.test(o.payment_terms ?? "");

// BL telex o impreso en destino: el BL se libera recién cuando paga el cliente.
export const liberaAlCobrar = (o: Operacion) => /telex|destino/i.test(o.tipo_bl ?? "");

// Documentos que hay que juntar antes de mandar a emitir originales.
export function documentos(o: Operacion): Paso[] {
  const lista: Paso[] = [
    { codigo: "doc_peso", nombre: "Certificado de peso (ISB)" },
    { codigo: "doc_calidad", nombre: "Certificado de calidad (ISB)" },
    { codigo: "doc_fumigacion", nombre: "Certificado de fumigación (ISB)" },
    { codigo: "doc_co", nombre: "Certificado de origen (Reymar)" },
    { codigo: "doc_fito", nombre: "Fitosanitario (Reymar)" },
    { codigo: "doc_bl", nombre: "BL fechado (forwarder)" },
    { codigo: "doc_pl", nombre: "Packing list" },
    { codigo: "doc_factura", nombre: "Factura Argreen" },
  ];
  if (o.silver) lista.push({ codigo: "doc_factura_silver", nombre: "Factura Silver" });
  return lista;
}

export function pasos(o: Operacion): Paso[] {
  const lista: Paso[] = [
    { codigo: "firma", nombre: "Contrato firmado" },
    { codigo: "etiqueta", nombre: "Etiqueta aprobada", ayuda: "Al menos 2 días antes de la carga en planta" },
  ];
  if (conAnticipo(o)) lista.push({ codigo: "anticipo", nombre: "Anticipo cobrado" });
  if (pideIp(o)) lista.push({ codigo: "ip", nombre: "IP emitido" });
  lista.push(
    { codigo: "booking", nombre: "Booking confirmado" },
    { codigo: "camiones", nombre: "Camiones cargados" },
    { codigo: "retiro", nombre: "Contenedores retirados" },
    { codigo: "consolidado", nombre: "Consolidado" },
    { codigo: "ddee", nombre: "DDEE aprobada" },
    { codigo: "draft_enviado", nombre: "Draft BL enviado al cliente" },
    { codigo: "draft_aprobado", nombre: "Draft BL aprobado", ayuda: "Alerta a los 2 días sin respuesta" },
    { codigo: "documentos", nombre: "Documentos completos", ayuda: "Se guardan en docus expo" },
    { codigo: "originales", nombre: "Originales emitidos", ayuda: "Se guardan en docus definitivos" },
    { codigo: "flete", nombre: "Pago de flete" },
  );
  const liberacion = { codigo: "liberacion_bl", nombre: "Liberación del BL" };
  const envio = { codigo: "envio_docs", nombre: "Envío de documentos" };
  const cobro = { codigo: "cobranza", nombre: "Cobranza" };
  if (!liberaAlCobrar(o)) lista.push(liberacion);
  // CAD: se mandan los documentos y después se cobra. Copy docs: al revés.
  if (esCopyDocs(o)) lista.push(cobro, envio);
  else lista.push(envio, cobro);
  // Telex o impreso en destino: se libera el BL cuando el cliente pagó.
  if (liberaAlCobrar(o)) lista.push({ ...liberacion, ayuda: "Con BL telex o impreso en destino se libera cuando paga el cliente" });
  return lista;
}

// "Documentos completos" está hecho si se marcó a mano o si están todos los de la lista.
export function documentosCompletos(o: Operacion, hechos: Map<string, Hito>): boolean {
  return hechos.has("documentos") || documentos(o).every((d) => hechos.has(d.codigo));
}

export function estaHecho(o: Operacion, codigo: string, hechos: Map<string, Hito>) {
  return codigo === "documentos" ? documentosCompletos(o, hechos) : hechos.has(codigo);
}

// El paso en el que está la operación: el primero sin hacer después del último hecho.
export function pasoActual(o: Operacion, hechos: Map<string, Hito>): Paso | null {
  const lista = pasos(o);
  let ultimo = -1;
  lista.forEach((p, i) => {
    if (estaHecho(o, p.codigo, hechos)) ultimo = i;
  });
  return lista.slice(ultimo + 1).find((p) => !estaHecho(o, p.codigo, hechos)) ?? null;
}

// ============================================================
// Etapas: los pasos agrupados en 6 partes fáciles de entender
// ============================================================
export type Etapa = { codigo: string; nombre: string; icono: string; pasos: string[] };

export const ETAPAS: Etapa[] = [
  { codigo: "contrato", nombre: "Contrato", icono: "📝", pasos: ["firma", "etiqueta", "anticipo", "ip"] },
  { codigo: "reserva", nombre: "Reserva del booking", icono: "📅", pasos: ["booking"] },
  { codigo: "carga", nombre: "Carga", icono: "🚛", pasos: ["camiones", "retiro", "consolidado", "ddee"] },
  { codigo: "documentos", nombre: "Documentos", icono: "📄", pasos: ["draft_enviado", "draft_aprobado", "documentos"] },
  { codigo: "originales", nombre: "Originales, flete y BL", icono: "🚢", pasos: ["originales", "flete", "liberacion_bl"] },
  { codigo: "cobro", nombre: "Envío y cobro", icono: "💰", pasos: ["envio_docs", "cobranza"] },
];

// Qué se está esperando, en palabras simples (para el paso actual).
export const EN_CURSO: Record<string, string> = {
  firma: "Esperando el contrato firmado",
  etiqueta: "Falta aprobar la etiqueta",
  anticipo: "Esperando el anticipo del cliente",
  ip: "Esperando el permiso de importación (IP)",
  booking: "Falta confirmar el barco (booking)",
  camiones: "Falta cargar los camiones en planta",
  retiro: "Falta retirar los contenedores",
  consolidado: "Falta consolidar en el depósito",
  ddee: "Falta aprobar el permiso de embarque",
  draft_enviado: "Falta mandar los borradores al cliente",
  draft_aprobado: "Esperando que el cliente apruebe los borradores",
  documentos: "Juntando los documentos finales",
  originales: "Falta emitir los originales",
  flete: "Falta pagar el flete",
  liberacion_bl: "Falta que liberen el BL",
  envio_docs: "Falta enviar los documentos",
  cobranza: "Esperando el cobro",
};

export type EstadoEtapa = "hecha" | "actual" | "pendiente";

export function etapas(o: Operacion, hechos: Map<string, Hito>) {
  const aplican = new Set(pasos(o).map((p) => p.codigo));
  const actual = pasoActual(o, hechos);
  const alCobrar = liberaAlCobrar(o);
  const lista = ETAPAS.map((e) => {
    // Con telex o impreso en destino la liberación del BL pasa a la última etapa
    const propios =
      e.codigo === "originales" && alCobrar ? e.pasos.filter((p) => p !== "liberacion_bl")
      : e.codigo === "cobro" && alCobrar ? [...e.pasos, "liberacion_bl"]
      : e.pasos;
    const ps = propios.filter((p) => aplican.has(p));
    const listos = ps.filter((p) => estaHecho(o, p, hechos)).length;
    return { ...e, ps, total: ps.length, listos };
  });
  const iActual = actual ? lista.findIndex((e) => e.ps.includes(actual.codigo)) : lista.length;
  return lista.map(({ ps: _ps, ...e }, i) => ({
    ...e,
    estado: (i < iActual ? "hecha" : i === iActual ? "actual" : "pendiente") as EstadoEtapa,
  }));
}

export function enPalabras(o: Operacion, hechos: Map<string, Hito>) {
  const a = pasoActual(o, hechos);
  return a ? EN_CURSO[a.codigo] ?? a.nombre : "Operación terminada";
}

// Todos los pasos que se pueden marcar (para elegir en "Por confirmar").
export const PASOS_MARCABLES: Paso[] = [
  { codigo: "firma", nombre: "Contrato firmado" },
  { codigo: "etiqueta", nombre: "Etiqueta aprobada" },
  { codigo: "anticipo", nombre: "Anticipo cobrado" },
  { codigo: "ip", nombre: "IP emitido" },
  { codigo: "booking", nombre: "Booking confirmado" },
  { codigo: "camiones", nombre: "Camiones cargados" },
  { codigo: "retiro", nombre: "Contenedores retirados" },
  { codigo: "consolidado", nombre: "Consolidado" },
  { codigo: "ddee", nombre: "DDEE aprobada" },
  { codigo: "draft_enviado", nombre: "Draft BL enviado al cliente" },
  { codigo: "draft_aprobado", nombre: "Draft BL aprobado" },
  { codigo: "doc_peso", nombre: "Certificado de peso (ISB)" },
  { codigo: "doc_calidad", nombre: "Certificado de calidad (ISB)" },
  { codigo: "doc_fumigacion", nombre: "Certificado de fumigación (ISB)" },
  { codigo: "doc_co", nombre: "Certificado de origen (Reymar)" },
  { codigo: "doc_fito", nombre: "Fitosanitario (Reymar)" },
  { codigo: "doc_bl", nombre: "BL fechado (forwarder)" },
  { codigo: "doc_pl", nombre: "Packing list" },
  { codigo: "doc_factura", nombre: "Factura Argreen" },
  { codigo: "doc_factura_silver", nombre: "Factura Silver" },
  { codigo: "originales", nombre: "Originales emitidos" },
  { codigo: "flete", nombre: "Pago de flete" },
  { codigo: "liberacion_bl", nombre: "Liberación del BL" },
  { codigo: "envio_docs", nombre: "Envío de documentos" },
  { codigo: "cobranza", nombre: "Cobranza" },
];

export const NOMBRE_RESPONSABLE: Record<string, string> = {
  lourdes: "Lourdes",
  valentina: "Valentina",
};

export const NOMBRE_FUENTE: Record<string, string> = {
  manual: "a mano",
  mail: "mail",
  drive: "carpeta de Drive",
  ventas: "VENTAS",
  seguimiento: "Seguimiento",
  proyeccion: "PROYECCION CARGAS",
  pagos_fletes: "PAGOS FLETES",
  cobranzas: "COBRANZAS",
};

export function fecha(d: string | null | undefined, conAnio = false): string {
  if (!d) return "—";
  const [y, m, dd] = d.slice(0, 10).split("-");
  return conAnio ? `${dd}/${m}/${y}` : `${dd}/${m}`;
}

export function nombreOperacion(o: { cv: string; lote: string | null }) {
  return `CV ${o.cv}${o.lote ? " " + o.lote : ""}`;
}
